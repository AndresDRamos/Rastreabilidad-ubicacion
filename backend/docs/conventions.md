# backend/docs/conventions.md

> Cuándo cargar: cuando estés por hacer un cambio que afecte algo "raro" del backend (concurrencia, env, caché, tipado) y quieras saber por qué está como está antes de tocarlo.

## Endpoints `def`, no `async def`

```python
@router.get("/api/pts/{idPt}/arbol")
def get_arbol(idPt: int, ..., conn = Depends(get_conn)) -> ArbolPT:   # ← def, no async
    ...
```

**Razón**: pyodbc es una librería C bloqueante. Si usas `async def`, el endpoint corre en el event loop principal y un query lento (1-3 s para PT grandes) bloquea todo el servidor. FastAPI corre los endpoints `def` en un threadpool, así que las requests concurrentes no se bloquean entre sí.

**Cuándo romper esta regla**: nunca, mientras pyodbc sea la única forma de hablar con SQL Server. Si migras a aioodbc/SQLAlchemy async, **mantén una sola convención por endpoint** — no mezcles.

## Una conexión pyodbc fresca por request

`deps.get_conn()` abre y cierra una conexión por cada request:

```python
def get_conn() -> Iterator[pyodbc.Connection]:
    settings = get_settings()
    conn = pyodbc.connect(settings.conn_string, timeout=settings.timeout)
    try:
        yield conn
    finally:
        conn.close()
```

**Razón**: pyodbc Connection NO es thread-safe entre threads. Cursor sí, Connection no. Como FastAPI corre los endpoints en threads distintos del pool, compartir una conexión global sería un bug latente.

**Costo**: abrir conexión tarda ~50-150 ms (handshake TCP + auth). Aceptable porque:
- `/api/pts` está cacheado 5 min (la mayoría de hits no llega aquí).
- `/api/pts/{id}/arbol` es manual del usuario, no en hot path.

**Si necesitas pool**: usa `pyodbc.pooling = True` (pooling a nivel ODBC driver, transparente), NO un pool a nivel Python. Verifica con load testing antes de meterlo.

## `extra="ignore"` en todos los modelos pydantic

`domain/modelo.py`:

```python
class _Base(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
```

**Razón**: las queries devuelven columnas que ningún modelo usa hoy (ej. `Lineas`, `LineasFirme` en `FilaListado` o columnas auxiliares en BOM). Si pydantic fuera estricto (`extra="forbid"`), cualquier `SELECT *` o columna nueva rompería todo.

**Costo / trade-off**: un typo en un campo (ej. `IdBomParant` por error) se ignora silenciosamente y el modelo queda con `None`. Si vas a renombrar columnas, agrega un test de smoke que afirme las columnas críticas.

## `Settings` cacheado + invalidación manual en tests

`config.py`:

```python
@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
```

Singleton de facto: la primera instancia se mantiene mientras el proceso vive. **El conftest e2e invalida el cache** después de inyectar variables desde `.env.test`:

```python
# tests/e2e/conftest.py
os.environ[k.strip()] = _parse_dotenv_value(raw_v)
get_settings.cache_clear()    # ← obligatorio
return get_settings()
```

Si no se invalida, `main.py` ya instanció `Settings()` al importarse y nunca leería las nuevas vars.

## structlog + `X-Correlation-Id`

`logging_setup.py`:

- **Dev** (`DEV=true`): `ConsoleRenderer` coloreado, legible.
- **Prod**: `JSONRenderer`, una línea JSON por evento. Compatible con Loki / Splunk / CloudWatch.
- Cada request genera un `correlation_id` (uuid4 hex) que se bindea al `contextvars` de structlog. Todos los logs del request lo incluyen automáticamente.
- El correlation_id sale en el header `X-Correlation-Id` para que el cliente pueda referenciar el request al reportar bugs.

**Si agregas un logger nuevo**:

```python
import structlog
log = structlog.get_logger("rbom_api.miñ_modulo")
log.info("algo_paso", clave=valor)   # estructurado, no f-strings
```

## TTL Cache del listado: 5 min, maxsize=4

`routers/pts.py`:

```python
_cache: TTLCache[int, list[FilaListado]] = TTLCache(maxsize=4, ttl=300)
_lock = threading.Lock()
```

**Razones**:
- TTL 300 s — la tabla `tblDemandaEPS` se mueve pero no segundo a segundo. 5 min es buen balance entre freshness y costo.
- maxsize=4 — sólo se usan ventanas típicas {1, 2, 3, 6}. Si excedes, se evicta el menos usado.
- `threading.Lock`, no `asyncio.Lock` — los endpoints son sync (ver arriba).

**Si quieres invalidar manualmente**:

```python
from rbom_api.routers.pts import _cache, _lock
with _lock:
    _cache.clear()
```

Pero **NO expongas un endpoint público** para invalidar. Si lo necesitas, hazlo con un secret o restríngelo a red interna.

## SQL queries con `DECLARE` y `_strip_param_declarations`

Los `.sql` traen `DECLARE @x = ISNULL(@x, default);` al inicio para que sean ejecutables tal cual en SSMS. Al ejecutarlos desde Python, prepend otro `DECLARE @x = valor_real;` y stripea los originales:

```python
sql_param = (
    f"DECLARE @idPT int = {int(idPT)};\n"
    f"DECLARE @ventana_meses int = {int(ventana_meses)};\n"
) + _strip_param_declarations(sql)
```

`_strip_param_declarations` busca líneas que arrancan con `declare @ventana_meses` o `declare @idpt` (case-insensitive) y las omite. **Si agregas un nuevo parámetro al query**, agrégale el stripping correspondiente al helper.

**Alternativa más limpia**: parametrizar con `cursor.execute(sql, params)` y poner los `?`. Implica reescribir las queries (no usar `DECLARE`). Es trabajo, pero quita esta complejidad. Por ahora se mantiene el patrón actual porque facilita debugging desde SSMS.

## `.env` files

| Archivo | Propósito | En git |
| --- | --- | --- |
| `backend/.env` | Credenciales reales en dev/prod | NO |
| `backend/.env.example` | Plantilla con placeholders | SÍ |
| `backend/.env.test` | Credenciales para tests e2e | NO |
| `backend/.env.test.example` | Plantilla del .env.test | SÍ |

`pydantic-settings` lee `.env` automáticamente (configurado en `Settings.model_config`). Los tests e2e cargan `.env.test` con un parser custom en `tests/e2e/conftest.py` que respeta comentarios inline (`# foo`).

**Si copias `.env.example` a `.env`**, recuerda quitar el placeholder `EPS_PASSWORD=changeme` y poner el real. El sistema fallará con `Login failed (18456)` si dejas el placeholder.

## Tipos y validación de path/query params

Uso `Annotated[int, Query(ge=..., le=...)]` en vez de los defaults:

```python
@router.get("/api/pts/{idPt}/arbol")
def get_arbol(
    idPt: int,
    ventana: Annotated[int, Query(ge=1, le=24)] = 3,
    ...
) -> ArbolPT:
```

- `Annotated[int, Query(...)]` es la sintaxis moderna (FastAPI ≥ 0.95).
- `ge`/`le` evita ventanas absurdas (ej. 1000 meses = query de 80 años).
- 422 automático para valores fuera de rango.

## Manejo de errores en routers

Sólo se capturan errores **esperados del dominio** y se mapean a HTTP:

```python
try:
    return armar_arbol(conn, idPt=idPt, ...)
except ValueError as exc:
    raise HTTPException(status_code=404, detail=str(exc)) from exc
```

Todo lo demás (pyodbc.Error, etc.) se propaga y FastAPI devuelve 500. La razón: no quiero esconder errores de BD con un 404 engañoso.

`/health` es la excepción: ahí sí capturamos `pyodbc.Error` y devolvemos 200 con `status=degraded`, porque queremos que el endpoint responda algo aunque la BD esté abajo.

## `SQL_DIR` como ruta absoluta

```python
PACKAGE_DIR = Path(__file__).parent
SQL_DIR = PACKAGE_DIR / "sql"
```

NO uses cwd-relative paths como `Path("sql")`. Si lanzas uvicorn desde otra carpeta (ej. desde la raíz del repo en lugar de `backend/`), `Path("sql")` se rompe. `Path(__file__).parent` siempre resuelve a la carpeta del archivo `config.py`.

`pyproject.toml` declara los `.sql` como package data:

```toml
[tool.setuptools.package-data]
rbom_api = ["sql/*.sql"]
```

Esto garantiza que `pip install` (sin `-e`) también los empaquete.
