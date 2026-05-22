# backend/docs/data-flow.md

> Cuándo cargar: cuando vayas a debuggear una request, agregar un endpoint o tocar la capa de acceso a SQL Server (`db.py` o los `sql/*.sql`).

## Ciclo de una request `GET /api/pts/{idPt}/arbol?ventana=3`

```
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
│   get_arbol(idPt, ventana, conn, settings)
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
│     rs.append(rows_to_dicts(cursor))    │     DEMANDA, BOM, RUTA, WIP
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
│   → ArbolPT (pydantic)                  │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│ FastAPI serializa ArbolPT a JSON        │  response_model=ArbolPT
└──────────────────┬──────────────────────┘
                   ▼
HTTP 200 + header X-Correlation-Id
       (CorrelationIdMiddleware emite request_end con duration_ms)
```

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
# result_sets[3] = WIP
```

Si `Q_detalle.sql` agrega o quita un `SELECT`, `fetch_detalle` se desincroniza. Lo blindo con un padding al final por si la query devuelve menos sets de los esperados:

```python
while len(result_sets) < 4:
    result_sets.append([])
return result_sets[0], result_sets[1], result_sets[2], result_sets[3]
```

## `_strip_param_declarations` — por qué existe

Las queries traen `DECLARE @ventana_meses int = ISNULL(@ventana_meses, 3)` en su cabecera para que sean ejecutables tal cual desde SSMS. Pero al ejecutarlas desde Python prependo otro `DECLARE @ventana_meses int = 3;` con el valor real:

```python
sql_param = (
    f"DECLARE @idPT int = {int(idPT)};\n"
    f"DECLARE @ventana_meses int = {int(ventana_meses)};\n"
) + _strip_param_declarations(sql)
```

Si no quitara los `DECLARE` originales del SQL, SQL Server tiraría error `"The variable name '@ventana_meses' has already been declared"`. El helper `_strip_param_declarations` elimina específicamente las líneas que arrancan con `declare @ventana_meses` o `declare @idpt` (case-insensitive).

**Si agregas un nuevo parámetro a un query**, actualiza el helper para que lo strippee también.

## Cache TTL del listado (`routers/pts.py`)

`GET /api/pts?ventana=N` consulta `tblDemandaEPS`, una tabla volátil que cambia con cada embarque. Pero el listado se pide cientos de veces por sesión (sidebar) y el costo es ~300-500 ms. Solución:

```python
_cache: TTLCache[int, list[FilaListado]] = TTLCache(maxsize=4, ttl=300)
_lock = threading.Lock()
```

- **TTL 300 s (5 min)** — balance entre freshness y costo. La demanda no se mueve segundo a segundo.
- **maxsize=4** — asume que sólo se usan ventanas {1, 2, 3, 6}.
- **`threading.Lock`** (no `asyncio.Lock`) — los endpoints son sync y corren en threadpool.
- **Solo `/api/pts`**, no `/api/pts/{id}/arbol`. El árbol lo cachea el frontend con TanStack (`staleTime: Infinity`).

## ASCII del orden de mount (main.py)

```
app = FastAPI(...)

app.add_middleware(CorrelationIdMiddleware)        ← (1)
if settings.dev:
    app.add_middleware(CORSMiddleware, ...)        ← (2) solo dev

app.include_router(health.router)                  ← (3) /health
app.include_router(pts.router)                     ← (4) /api/pts
app.include_router(arbol.router)                   ← (5) /api/pts/{idPt}/arbol

if STATIC_DIR.exists():                            ← (6) último
    app.mount("/", StaticFiles(...), name="static")
```

El orden importa: si `StaticFiles` se monta antes que los routers, intercepta `/api` y rompe la API. Si `CorrelationIdMiddleware` se agrega después de incluir routers, no envuelve los endpoints.

## Logging por request

`CorrelationIdMiddleware` emite dos eventos estructurados por request:

```json
{"event":"request_start","method":"GET","path":"/api/pts/91711066/arbol","correlation_id":"abc..."}
{"event":"request_end","status":200,"duration_ms":1234.5,"correlation_id":"abc..."}
```

Adicionalmente `services/arbol_service.py` loguea por query:

```json
{"event":"db_query","query":"Q_detalle","idPt":91711066,"rows_bom":3,"rows_ruta":7,"rows_wip":2,"duration_ms":845.2}
{"event":"netteo_done","idPt":91711066,"n_componentes":3,"n_advertencias":0,"duration_ms":12.4}
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

`/health` retorna `200 + degraded` en vez de 5xx cuando la BD está abajo para no romper monitoreo agresivo. Tu liveness probe puede simplemente verificar `status == "ok"` y `db_ok == true`.
