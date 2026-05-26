# backend/docs/data-flow.md

> Cuándo cargar: cuando vayas a debuggear una request, agregar un endpoint o tocar la capa de acceso a SQL Server (`db.py` o los `sql/*.sql`).

## Mapa de endpoints

| Endpoint | Service / función | Query | Cache server | Cache cliente |
| --- | --- | --- | --- | --- |
| `GET /health` | `db.ping` | `SELECT 1` | — | — |
| `GET /api/pts?ventana=N&fecha_max=…` | `arbol_service.listar_pts` | `Q_listado.sql` | TTL 300s, maxsize 32, key=(ventana, fecha_max) | TanStack staleTime 5 min |
| `GET /api/pts/{idPt}/arbol?ventana=N&fecha_max=…` | `arbol_service.armar_arbol` | `Q_detalle.sql` (4 result-sets) | — | TanStack `staleTime: Infinity` |
| `GET /api/bloques?cliente=&planta=&ciudades=&tipos_material=&clases=` | `db.fetch_bloques` directo | `Q_bloques.sql` | TTL 120s, maxsize 128 | TanStack staleTime 2 min |
| `GET /api/bloques/{idProceso}/pts?…` | `db.fetch_pts_en_proceso` directo | `Q_pts_en_proceso.sql` | TTL 120s, maxsize 256 | TanStack staleTime 2 min |
| `GET /api/plantas` | `db.fetch_plantas` directo | `Q_plantas.sql` | TTL 600s, maxsize 1 | TanStack staleTime 10 min |

Nota: los endpoints del Resumen llaman directo a `db.*` sin pasar por `services/` porque no hay netteo ni transformación de dominio que justifique una capa extra. Si en el futuro agregas lógica de negocio sobre `BloqueProceso`, crea `services/bloques_service.py` y mueve la llamada ahí — el patrón está pensado para crecer en esa dirección.

## Ciclo de una request `GET /api/pts/{idPt}/arbol?ventana=3`

```text
HTTP client (browser, curl, TestClient)
    │
    ▼
┌─────────────────────────────────────────┐
│ CorrelationIdMiddleware                 │  - genera X-Correlation-Id (uuid4 hex)
│ (logging_setup.py)                      │  - bindea correlation_id al contextvar de structlog
│                                         │  - emite request_start
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│ CORSMiddleware  (solo si DEV=true)      │  origins=[localhost:5173, 127.0.0.1:5173]
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│ Router  routers/arbol.py                │  parsea path/query con Annotated[int, Query(...)]
│   get_arbol(idPt, ventana, fecha_max,   │
│             conn, settings)             │
└──────────────────┬──────────────────────┘
                   │ Depends(get_conn)
                   ▼
┌─────────────────────────────────────────┐
│ deps.get_conn()                         │  pyodbc.connect(settings.conn_string, timeout=120)
│   yield conn                            │  yield al endpoint
│   finally: conn.close()                 │  cierra al final del request
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│ services.arbol_service.armar_arbol      │  validación pydantic + logging duración
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│ domain.db.fetch_detalle                 │  ejecuta Q_detalle.sql como batch único
│   cursor.execute(sql con DECLARE)       │  → 4 result-sets en orden
│   while True:                           │
│     rs.append(rows_to_dicts(cursor))    │     DEMANDA, BOM, RUTA, WIP (3 buckets)
│     if not cursor.nextset(): break      │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│ Validación: [FilaBom(**f) for f in bom] │  descarta columnas extra (extra="ignore")
│             [FilaRuta(**f) for f in...] │
│             [FilaWip(**f) for f in...]  │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│ domain.netteo.construir_arbol           │  algoritmo 2 pasadas (ver algoritmo-netteo.md)
│   → ArbolPT (pydantic)                  │  hidrata wip_en_paso + liberadas + en_inspeccion
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│ FastAPI serializa ArbolPT a JSON        │  response_model=ArbolPT
└──────────────────┬──────────────────────┘
                   ▼
HTTP 200 + header X-Correlation-Id
       (CorrelationIdMiddleware emite request_end con duration_ms)
```

## Ciclo de una request `GET /api/bloques?cliente=…&ciudades=…`

```text
Router routers/bloques.py
    │
    ▼ _parse_int_csv("a,b,c") → [int]
    │ key = (cliente, planta, tuple(sorted(ciudades)), tuple(sorted(tipos)), tuple(sorted(clases)))
    ▼
TTLCache hit? ──── sí ──► devuelve list[BloqueProceso] cacheada
    │
    no
    ▼
db.fetch_bloques(conn, **kwargs)
    │
    ▼
_leer_sql("Q_bloques.sql")
sql.replace("/*CIUDADES_FILTER*/", _ciudades_predicate(ids))   ← "AND d.idCiudad IN (137,738)"
sql.replace("/*TIPOMAT_FILTER*/",  _tipomat_predicate(ids))    ← "AND m.idTipoMaterial IN (1,3)"
sql.replace("/*CLASE_FILTER*/",    _clase_predicate(ids))      ← "AND I.CLASS_ID_ARTCULO_ID IN (12)"
prepend DECLARE @idCliente / @idPlantaFiltro / @conFiltroUniverso
strip declares originales del .sql
    │
    ▼
cursor.execute → list[dict]
    │
    ▼
[BloqueProceso(**r) for r in rows] → cache → response
```

`_*_predicate` siempre castea cada id como `int(...)` antes de embeber. Es la única defensa anti-inyección en este path; no concatenes strings del usuario por fuera de esos helpers.

## Multi-resultset: por qué y cómo

`Q_detalle.sql` es un único batch SQL que ejecuta cuatro `SELECT` consecutivos. pyodbc expone esto como result-sets encadenados:

```python
cursor.execute(sql_batch)
result_sets = []
while True:
    result_sets.append(_rows_to_dicts(cursor))   # primer SELECT
    if not cursor.nextset():                     # avanza al siguiente
        break
# result_sets[0] = DEMANDA
# result_sets[1] = BOM
# result_sets[2] = RUTA
# result_sets[3] = WIP (3 buckets en columnas)
```

Si `Q_detalle.sql` agrega o quita un `SELECT`, `fetch_detalle` se desincroniza. Lo blindo con padding al final por si la query devuelve menos sets de los esperados:

```python
while len(result_sets) < 4:
    result_sets.append([])
return result_sets[0], result_sets[1], result_sets[2], result_sets[3]
```

El 4° result-set (WIP) trae 3 pares de columnas — `(Etiquetas, Piezas)` para "Por procesar", `(EtiquetasLiberadas, PiezasLiberadas)` y `(EtiquetasInspeccion, PiezasInspeccion)` — todos en la misma fila por `(idComp, idProceso)`. Ver `algoritmo-netteo.md` para qué bucket alimenta cada cosa.

## `_strip_param_declarations` — por qué existe

Las queries traen `DECLARE @x int = ISNULL(@x, default);` en su cabecera para que sean ejecutables tal cual desde SSMS. Pero al ejecutarlas desde Python prependo otro `DECLARE @x int = valor_real;` con el valor que recibo del router:

```python
sql_param = (
    f"DECLARE @idPT int = {int(idPT)};\n"
    f"DECLARE @ventana_meses int = {int(ventana_meses)};\n"
    f"DECLARE @fecha_max date = '{fecha_max}';\n"   # o NULL
) + _strip_param_declarations(sql)
```

Si no quitara los `DECLARE` originales del SQL, SQL Server tiraría `"The variable name '@x' has already been declared"`. El helper `_strip_param_declarations` elimina específicamente las líneas que arrancan con (case-insensitive):

- `declare @ventana_meses`
- `declare @idpt`
- `declare @fecha_max`
- `declare @idplantafiltro`
- `declare @idprocesoselected`
- `declare @idcliente`
- `declare @confiltrouniverso`

**Si agregas un nuevo parámetro a un query**, actualiza el helper para que lo strippee también. Si te lo saltas, los tests no lo detectan (son sintéticos): lo detectarás solo al ejecutar contra BD real.

## Cache de los listados (`routers/pts.py`)

`GET /api/pts?ventana=N&fecha_max=…` consulta `tblDemandaEPS`, una tabla volátil que cambia con cada embarque. Pero el listado se pide cientos de veces por sesión (sidebar) y el costo es ~300-500 ms. Solución:

```python
_cache: TTLCache[tuple[int, str | None], list[FilaListado]] = TTLCache(maxsize=32, ttl=300)
_lock = threading.Lock()
```

- **TTL 300 s (5 min)** — balance entre freshness y costo. La demanda no se mueve segundo a segundo.
- **maxsize=32** — permite múltiples combinaciones de (ventana, fecha_max). Antes era 4 cuando solo había ventana; el techo se subió al agregar el parámetro `fecha_max`.
- **`threading.Lock`** (no `asyncio.Lock`) — los endpoints son sync y corren en threadpool.
- **Solo `/api/pts`**, no `/api/pts/{id}/arbol`. El árbol lo cachea el frontend con TanStack (`staleTime: Infinity`).

## Cache de la vista Resumen (`routers/bloques.py`)

Tres caches separadas:

```python
_cache_bloques: TTLCache[_CacheKeyBloques, list[BloqueProceso]] = TTLCache(maxsize=128, ttl=120)
_cache_pts:     TTLCache[_CacheKeyPts,     list[PTEnProceso]]   = TTLCache(maxsize=256, ttl=120)
_cache_plantas: TTLCache[str,              list[Planta]]        = TTLCache(maxsize=1,   ttl=600)
```

- **TTL 120 s (2 min)** para bloques y `pts-en-proceso`: el Resumen muestra inventario que sí se mueve durante el día (etiquetas LIBERADAS y remisiones). 2 min es el balance que aceptamos para no martillar la BD cuando el usuario cambia filtros rápido.
- **maxsize alto** (128/256) porque la combinatoria de filtros es grande. Una `_lock` global cubre las 3 caches; los costos de contención son despreciables (operación de Map).
- **`plantas` 10 min**: el catálogo de plantas con actividad cambia con baja frecuencia.

Si una mutación del WIP (en otro sistema) tiene que reflejarse antes de 2 min, agrega un endpoint de invalidación o expón un botón "refrescar" desde el frontend que invalide TanStack — **no** bajes el TTL global.

## ASCII del orden de mount (`main.py`)

```text
app = FastAPI(...)

app.add_middleware(CorrelationIdMiddleware)        ← (1)
if settings.dev:
    app.add_middleware(CORSMiddleware, ...)        ← (2) solo dev

app.include_router(health.router)                  ← (3) /health
app.include_router(pts.router)                     ← (4) /api/pts
app.include_router(arbol.router)                   ← (5) /api/pts/{idPt}/arbol
app.include_router(bloques.router)                 ← (6) /api/bloques + /api/plantas

if STATIC_DIR.exists():                            ← (7) último
    app.mount("/", StaticFiles(...), name="static")
```

El orden importa: si `StaticFiles` se monta antes que los routers, intercepta `/api` y rompe la API. Si `CorrelationIdMiddleware` se agrega después de incluir routers, no envuelve los endpoints.

## Logging por request

`CorrelationIdMiddleware` emite dos eventos estructurados por request:

```json
{"event":"request_start","method":"GET","path":"/api/pts/91711066/arbol","correlation_id":"abc..."}
{"event":"request_end","status":200,"duration_ms":1234.5,"correlation_id":"abc..."}
```

Adicionalmente cada query loguea su duración:

```json
{"event":"db_query","query":"Q_detalle","idPt":91711066,"rows_bom":3,"rows_ruta":7,"rows_wip":2,"duration_ms":845.2}
{"event":"netteo_done","idPt":91711066,"n_componentes":3,"n_advertencias":0,"duration_ms":12.4}
{"event":"db_query","query":"Q_bloques","cliente":12,"planta":null,"ciudades":[137],"tipos_material":[],"clases":[],"rows":18,"duration_ms":420.3}
```

El `correlation_id` se propaga vía `contextvars` de structlog, sin que tengas que pasarlo a mano.

## Errores y status codes

| Situación | Excepción interna | Status code | Body |
| --- | --- | --- | --- |
| BD caída en `/health` | pyodbc.Error capturada | 200 | `{status:"degraded", db_ok:false, db_error:"..."}` |
| BD caída en `/api/*` | `pyodbc.Error` no capturada | 500 | error genérico de FastAPI |
| PT sin demanda activa | `ValueError("Sin filas de demanda...")` | 404 | `{detail: "Sin filas de demanda — ..."}` |
| PT no existe en BOM | `ValueError("Sin filas de BOM...")` | 404 | `{detail: "Sin filas de BOM — ..."}` |
| `ventana` fuera de [1, 24] | Pydantic validation (Query) | 422 | error standard de FastAPI |
| `fecha_max` no parseable como date | Pydantic validation (Query) | 422 | error standard de FastAPI |
| `idProceso` no existe en `tblProceso` | Q_bloques/pts devuelve lista vacía | 200 | `[]` |

`/health` retorna `200 + degraded` en vez de 5xx cuando la BD está abajo para no romper monitoreo agresivo. Tu liveness probe puede simplemente verificar `status == "ok"` y `db_ok == true`.
