# backend/docs/architecture.md

> Cuándo cargar: cuando vayas a tocar un módulo del backend y quieras entender en qué capa vive, qué responsabilidades tiene y a qué se conecta.

## Capas

```
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
              │     Routers (routers/)   │   /health · /api/pts · /api/pts/{id}/arbol
              │   thin: parse → service  │
              └──────────────┬───────────┘
                             │  Depends(get_conn) → pyodbc.Connection
                             ▼
              ┌──────────────────────────┐
              │   Services (services/)   │   arbol_service.armar_arbol / listar_pts
              │   orquesta SQL + netteo  │
              └──────────────┬───────────┘
                             │
              ┌──────────────┴───────────┐
              ▼                          ▼
        ┌──────────┐              ┌────────────┐
        │   db.py  │              │ netteo.py  │
        │ pyodbc   │              │ algoritmo  │
        │ multi-rs │              │ Kahn + ruta│
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

| Archivo | Líneas | Responsabilidad |
| --- | --- | --- |
| `__init__.py` | 1 | Expone `__version__ = "0.1.0"`. |
| `main.py` | ~66 | App factory `create_app()`. Orden: middlewares → routers → StaticFiles (si existe `static/`). Exporta `app = create_app()` para uvicorn. |
| `config.py` | ~62 | `Settings` (pydantic-settings) + `get_settings()` (`@lru_cache`). Define `SQL_DIR = Path(__file__).parent / "sql"`. Construye `conn_string` para pyodbc. |
| `deps.py` | ~25 | `get_conn()` generador: abre `pyodbc.connect()`, hace `yield`, cierra en `finally`. FastAPI lo inyecta con `Depends(get_conn)`. |
| `logging_setup.py` | ~86 | `configurar_logging()` + `CorrelationIdMiddleware`. structlog ConsoleRenderer en dev, JSONRenderer en prod. Genera/propaga `X-Correlation-Id`. |
| `routers/health.py` | ~30 | `GET /health` → `{status, db_ok, version, db_error?}`. Hace `db.ping(conn)`. |
| `routers/pts.py` | ~43 | `GET /api/pts?ventana=N` → `list[FilaListado]`. **Cache TTL=300s, maxsize=4, threading.Lock**. Key = `ventana`. |
| `routers/arbol.py` | ~34 | `GET /api/pts/{idPt}/arbol?ventana=N` → `ArbolPT`. Sin cache (TanStack del frontend cachea). 404 si `ValueError`. |
| `services/arbol_service.py` | ~80 | `listar_pts(conn, ventana)` y `armar_arbol(conn, idPt, ventana, settings)`. Validan pydantic, loguean duración, delegan a `domain/`. |
| `domain/modelo.py` | ~138 | 10 modelos pydantic (`FilaListado`, `FilaBom`, `FilaRuta`, `FilaWip`, `DemandaPT`, `PasoRuta`, `AristaPadre`, `NodoComponente`, `ArbolPT`). Base con `extra="ignore"`. |
| `domain/netteo.py` | ~306 | `construir_arbol(...)` — algoritmo de 2 pasadas. Helpers: `_topological_sort` (Kahn), `_bfs_reachable`, `_construir_pasos` (agrupación + buffer virtual + pasada inversa), `_fmt`. |
| `domain/db.py` | ~93 | `fetch_listado(conn, ventana_meses)`, `fetch_detalle(conn, idPT, ventana_meses)` (multi-resultset con `cursor.nextset()`), `ping(conn)`, `_strip_param_declarations` (helper). |
| `sql/Q_listado.sql` | ~52 | PTs con demanda activa en `tblDemandaEPS`. Past-due incluido (sin piso de fecha). Agrupa por (idMaterial, idCliente, idCiudad). |
| `sql/Q_detalle.sql` | ~148 | 4 result-sets para un PT: DEMANDA, BOM (`tblBomExplosionado`, filtro `IdTipoMaterial IN (1,3)`), RUTA (`tblMaterialRutaTiempo` + `LEAD()`), WIP (`tblEtiqueta`). |

## Ciclo de vida de la conexión

```
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
- `extra="ignore"` para tolerar vars no mapeadas (ej. `DEV`, `LOG_LEVEL` opcionales).
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

## Lo que NO está aquí

- No hay ORM. Las queries son SQL crudas en `sql/*.sql`.
- No hay pool de conexiones. Ver `deps.py`.
- No hay background tasks ni colas.
- No hay autenticación. El servicio es interno y se asume detrás de la red privada.
- No hay versionado de API (`/v1`). Si se añade, ponerlo en los routers nuevos sin tocar los existentes.
