# backend/docs/architecture.md

> Cuándo cargar: cuando vayas a tocar un módulo del backend y quieras entender en qué capa vive, qué responsabilidades tiene y a qué se conecta.

## Capas

```text
                          HTTP
                            │
                            ▼
              ┌──────────────────────────┐
              │   Middlewares (main.py)  │
              │  CorrelationId │ CORS dev │
              └──────────────┬───────────┘
                             │
                             ▼
              ┌──────────────────────────┐
              │     Routers (routers/)   │   /health
              │   thin: parse → service  │   /api/pts        /api/pts/{id}/arbol
              │   con cache TTL opcional │   /api/bloques    /api/bloques/{id}/pts
              └──────────────┬───────────┘   /api/plantas
                             │  Depends(get_conn) → pyodbc.Connection
                             ▼
              ┌──────────────────────────┐
              │   Services (services/)   │   arbol_service.armar_arbol / listar_pts
              │   orquesta SQL + netteo  │   (el router bloques llama directo a db.*,
              │                          │    no hace netteo, no necesita service propio)
              └──────────────┬───────────┘
                             │
              ┌──────────────┴───────────┐
              ▼                          ▼
        ┌──────────┐              ┌────────────┐
        │   db.py  │              │ netteo.py  │
        │ pyodbc   │              │ algoritmo  │
        │ multi-rs │              │ Kahn + ruta│
        │ placeholders /*..*/     │ inversa    │
        └────┬─────┘              └─────┬──────┘
             │                          │
             ▼                          ▼
        ┌──────────┐              ┌────────────┐
        │ sql/*.sql│              │ modelo.py  │
        │  Q_*.sql │              │ pydantic   │
        └──────────┘              └────────────┘
                                    ▲
                                    │
            ┌───────────────────────┘
            │
            ▼
   (al final, después de los routers)
   StaticFiles "/"  ← frontend/dist copiado a src/rbom_api/static/
```

## Inventario por archivo (`backend/src/rbom_api/`)

| Archivo | Líneas (aprox.) | Responsabilidad |
| --- | --- | --- |
| `__init__.py` | 1 | Expone `__version__ = "0.1.0"`. |
| `main.py` | ~66 | App factory `create_app()`. Orden: middlewares → routers (`health`, `pts`, `arbol`, `bloques`) → StaticFiles (si existe `static/`). Exporta `app = create_app()` para uvicorn. |
| `config.py` | ~62 | `Settings` (pydantic-settings) + `get_settings()` (`@lru_cache`). Define `SQL_DIR = Path(__file__).parent / "sql"`. Construye `conn_string` para pyodbc. |
| `deps.py` | ~25 | `get_conn()` generador: abre `pyodbc.connect()`, hace `yield`, cierra en `finally`. FastAPI lo inyecta con `Depends(get_conn)`. |
| `logging_setup.py` | ~86 | `configurar_logging()` + `CorrelationIdMiddleware`. structlog `ConsoleRenderer` en dev, `JSONRenderer` en prod. Genera/propaga `X-Correlation-Id`. |
| `routers/health.py` | ~30 | `GET /health` → `{status, db_ok, version, db_error?}`. Hace `db.ping(conn)`. |
| `routers/pts.py` | ~50 | `GET /api/pts?ventana=N&fecha_max=YYYY-MM-DD` → `list[FilaListado]`. **Cache TTL=300s, maxsize=32, threading.Lock**. Key = `(ventana, fecha_max_iso \| None)`. |
| `routers/arbol.py` | ~43 | `GET /api/pts/{idPt}/arbol?ventana=N&fecha_max=YYYY-MM-DD` → `ArbolPT`. Sin cache server-side (TanStack del frontend cachea infinito). 404 si `ValueError`. |
| `routers/bloques.py` | ~210 | Vista Resumen — 3 endpoints con cache propio: `GET /api/bloques` (TTL=120s, maxsize=128), `GET /api/bloques/{idProceso}/pts` (TTL=120s, maxsize=256), `GET /api/plantas` (TTL=600s, maxsize=1). Acepta CSV `ciudades=…&tipos_material=…&clases=…` y los parsea con `_parse_int_csv`. |
| `services/arbol_service.py` | ~90 | `listar_pts(conn, ventana, fecha_max)` y `armar_arbol(conn, idPt, ventana, settings, fecha_max)`. Validan pydantic, loguean duración, delegan a `domain/`. |
| `domain/modelo.py` | ~192 | 13 modelos pydantic. Entrada: `FilaListado`, `FilaBom`, `FilaRuta`, `FilaWip`. Salida árbol: `DemandaPT`, `PasoRuta`, `AristaPadre`, `NodoComponente`, `ArbolPT`. Salida Resumen: `BloqueProceso`, `PTEnProceso`, `Planta`. Base con `extra="ignore"`. |
| `domain/netteo.py` | ~342 | `construir_arbol(...)` — algoritmo de 2 pasadas. Consolida demanda multi-cliente. Helpers: `_topological_sort` (Kahn), `_bfs_reachable`, `_construir_pasos` (agrupación + buffer virtual + pasada inversa), `_fmt`. |
| `domain/db.py` | ~210 | Lectores SQL: `fetch_listado`, `fetch_detalle` (multi-resultset), `fetch_bloques`, `fetch_pts_en_proceso`, `fetch_plantas`. Helpers: `_strip_param_declarations`, `_decl_int`, `_ciudades_predicate`, `_tipomat_predicate`, `_clase_predicate`. `ping(conn)` para `/health`. |
| `sql/Q_listado.sql` | ~63 | PTs con demanda activa en `tblDemandaEPS`. Past-due incluido (sin piso de fecha). `@fecha_max` opcional. JOIN con NETSUITE para `idClase`/`Clase`. Agrupa por (idMaterial, idCliente, idCiudad, idClase). |
| `sql/Q_detalle.sql` | ~205 | 4 result-sets para un PT: DEMANDA, BOM (`tblBomExplosionado`, filtro `IdTipoMaterial IN (1,3)`, expone `PrimerIdProceso`/`UltimoIdProceso`), RUTA (`tblMaterialRutaTiempo` + `LEAD()`), WIP en 3 buckets (Por procesar / Liberadas / En Inspección) con `EXCEPT vwEtiquetasEnRemision`. |
| `sql/Q_bloques.sql` | ~110 | Una fila por `idProcesoSiguiente` con totales WIP. Filtros opcionales por cliente, planta, ciudades (`/*CIUDADES_FILTER*/`), tipos material (`/*TIPOMAT_FILTER*/`) y clase NetSuit (`/*CLASE_FILTER*/`). Bandera `@conFiltroUniverso` activa el filtrado por componentes de PTs con demanda. |
| `sql/Q_pts_en_proceso.sql` | ~95 | PTs cuyos componentes tienen WIP esperando entrar a `@idProcesoSelected`. Mismos placeholders de filtros que `Q_bloques`. |
| `sql/Q_plantas.sql` | ~30 | Plantas con al menos una etiqueta activa (no remisionada). Alimenta el dropdown. |

## Ciclo de vida de la conexión

```text
Request               Response
   │                     ▲
   ▼                     │
get_conn() yield ─────── close()
   │                     ▲
   ▼                     │
pyodbc.connect()    finally:
   │                     │
   ▼                     │
endpoint(conn) ──────────┘
```

Una conexión nueva por request. Sin pool. `pyodbc.Connection` no es thread-safe entre threads — la decisión de FastAPI de correr endpoints sync en threadpool hace que cada thread tenga su propia conexión efímera. Es seguro y simple.

## `Settings` y `SQL_DIR`

`Settings` vive en `config.py`:

- Carga `.env` (pydantic-settings) con `env_file=".env"`.
- `extra="ignore"` para tolerar vars no mapeadas (ej. otras keys opcionales).
- `get_settings()` está cacheado con `@lru_cache(maxsize=1)` — singleton de facto.
- `SQL_DIR` es **ruta absoluta** al package: `Path(__file__).parent / "sql"`. Esto permite que `pip install -e .` siga encontrando los `.sql` aunque el cwd sea otro.
- `conn_string` construye el ODBC connection string con `TrustServerCertificate=yes` (cert self-signed del server EPS).

## StaticFiles mount

```python
STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists() and STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
```

- **Solo se monta si la carpeta existe.** En desarrollo no existe (el frontend lo sirve Vite).
- En producción, `scripts/build.ps1` copia `frontend/dist/*` → `backend/src/rbom_api/static/`.
- **El mount está DESPUÉS de los routers** — `/api/*` y `/health` se resuelven antes que StaticFiles. Si pusieras StaticFiles antes, interceptaría todo.
- `html=True` hace SPA fallback: cualquier ruta no encontrada devuelve `index.html`.

## Familia de routers: cuándo crear uno nuevo

Patrón actual (sirve para escalar):

- **`pts.py`**: cache simple keyed por (ventana, fecha_max). Pocas variantes, datos pesados de hidratar.
- **`arbol.py`**: sin cache server-side. El cliente cachea infinito por sesión y el resultado es muy específico (un PT × ventana × fecha_max).
- **`bloques.py`**: cache multi-key con tuplas ordenadas, una `TTLCache` por endpoint. Filtros opcionales.

Si vas a agregar un endpoint nuevo:

1. ¿Devuelve el mismo dato a muchos clientes con pocas variantes? → cache estilo `pts.py`.
2. ¿Es muy específico, casi único por usuario? → sin cache server-side, deja que TanStack lo maneje.
3. ¿Combina varios filtros y la combinatoria es grande pero los hits son frecuentes? → cache estilo `bloques.py` con `tuple(sorted(...))` en la key para que `[1,2]` y `[2,1]` colisionen.

## Lo que NO está aquí

- No hay ORM. Las queries son SQL crudas en `sql/*.sql`.
- No hay pool de conexiones. Ver `deps.py`.
- No hay background tasks ni colas.
- No hay autenticación. El servicio es interno y se asume detrás de la red privada.
- No hay versionado de API (`/v1`). Si se añade, ponerlo en los routers nuevos sin tocar los existentes — el orden de mount en `main.py` no cambia.
- No hay generador automático de tipos para el frontend; `frontend/src/api/types.ts` se mantiene a mano.
