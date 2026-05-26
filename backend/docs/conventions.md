# backend/docs/conventions.md

> Cuándo cargar: cuando estés por hacer un cambio que afecte algo "raro" del backend (concurrencia, env, caché, tipado, placeholders SQL) y quieras saber por qué está como está antes de tocarlo.

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

**Razón**: pyodbc `Connection` NO es thread-safe entre threads. Cursor sí, Connection no. Como FastAPI corre los endpoints en threads distintos del pool, compartir una conexión global sería un bug latente.

**Costo**: abrir conexión tarda ~50-150 ms (handshake TCP + auth). Aceptable porque:

- `/api/pts` y `/api/bloques` están cacheados (5 min y 2 min respectivamente) — la mayoría de hits no llega aquí.
- `/api/pts/{id}/arbol` es manual del usuario, no en hot path.

**Si necesitas pool**: usa `pyodbc.pooling = True` (pooling a nivel ODBC driver, transparente), NO un pool a nivel Python. Verifica con load testing antes de meterlo.

## `extra="ignore"` en todos los modelos pydantic

`domain/modelo.py`:

```python
class _Base(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")
```

**Razón**: las queries devuelven columnas que ningún modelo usa hoy (`Lineas`, `LineasFirme`, etc.). Si pydantic fuera estricto (`extra="forbid"`), cualquier `SELECT *` o columna nueva rompería todo. El schema de EPS evoluciona; el modelo tiene que tolerar deriva.

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
log = structlog.get_logger("rbom_api.mi_modulo")
log.info("algo_paso", clave=valor)   # estructurado, no f-strings
```

## TTL Cache: dos patrones

Hoy conviven dos formas, según la combinatoria de filtros del endpoint:

### Patrón A — cache por (ventana, fecha_max), maxsize 32 (`routers/pts.py`)

```python
_cache: TTLCache[tuple[int, str | None], list[FilaListado]] = TTLCache(maxsize=32, ttl=300)
_lock = threading.Lock()
```

Sirve cuando los parámetros relevantes son pocos y la cardinalidad es baja.

### Patrón B — cache multi-filtro keyed por tuplas ordenadas (`routers/bloques.py`)

```python
_CacheKeyBloques = tuple[
    int | None, int | None, tuple[int, ...], tuple[int, ...], tuple[int, ...]
]
key = (
    cliente,
    planta,
    tuple(sorted(ids_ciudad)),
    tuple(sorted(ids_tipo)),
    tuple(sorted(ids_clase)),
)
```

Reglas para escalar:

- **Siempre `tuple(sorted(...))`** para que `[1, 2]` y `[2, 1]` colisionen — si no, los hits se desperdician.
- **Una key explícita por endpoint** (no compartas la cache entre 2 endpoints aunque acepten los mismos filtros).
- **`threading.Lock`** global del módulo, no por cache.
- **TTL más corto que el patrón A** (120 s vs 300 s) porque el dataset es más volátil (movimientos de etiquetas durante el día).

**Si quieres invalidar manualmente**:

```python
from rbom_api.routers.bloques import _cache_bloques, _cache_pts, _lock
with _lock:
    _cache_bloques.clear()
    _cache_pts.clear()
```

Pero **NO expongas un endpoint público** para invalidar. Si lo necesitas, hazlo con un secret o restríngelo a red interna.

## SQL queries: cabecera `DECLARE` + placeholders `/*FILTRO*/`

### `DECLARE` defaults para ejecución SSMS

Los `.sql` traen `DECLARE @x = ISNULL(@x, default);` al inicio para que sean ejecutables tal cual en SSMS. Al ejecutarlos desde Python, prepend otro `DECLARE @x = valor_real;` y stripea los originales:

```python
sql_param = (
    f"DECLARE @idPT int = {int(idPT)};\n"
    f"DECLARE @ventana_meses int = {int(ventana_meses)};\n"
    f"DECLARE @fecha_max date = '{fecha_max}';\n"   # o NULL
) + _strip_param_declarations(sql)
```

`_strip_param_declarations` busca líneas que arrancan con `declare @x` (case-insensitive) para una lista hard-coded de variables. **Si agregas un nuevo parámetro al query**, agrégale el stripping correspondiente al helper.

**Alternativa más limpia**: parametrizar con `cursor.execute(sql, params)` y poner `?` en el SQL. Implica reescribir las queries (no usar `DECLARE`). Es trabajo, pero quita esta complejidad. Hoy mantenemos el patrón actual porque facilita debugging desde SSMS.

### Placeholders `/*FILTRO*/` para `IN (...)` dinámicos

T-SQL no parametriza listas; `WHERE x IN (?, ?, ?)` necesitaría un `?` por elemento. La solución en este repo es **string-replacement de comentarios**:

```sql
WHERE d.bActivo = 1
  AND (@idCliente IS NULL OR d.idCliente = @idCliente)
  /*CIUDADES_FILTER*/
  /*CLASE_FILTER*/
```

Y desde Python:

```python
sql = sql.replace("/*CIUDADES_FILTER*/", _ciudades_predicate(ids_ciudad))
sql = sql.replace("/*TIPOMAT_FILTER*/", _tipomat_predicate(ids_tipo_material))
sql = sql.replace("/*CLASE_FILTER*/",   _clase_predicate(ids_clase))
```

Cada `_*_predicate`:

1. Si la lista es vacía/None → devuelve `""` (no se filtra).
2. Si no → castea **cada id como `int(...)`** y arma `AND tabla.col IN (1,2,3)`.

El cast a `int(...)` es la única defensa anti-inyección. Si agregas un placeholder nuevo, **sigue el patrón exacto**: nunca interpoles strings del usuario sin pasarlos por `int(...)` o un parser equivalente.

**Cuándo agregar un placeholder nuevo**:

1. Agrega el comentario al `.sql` (`/*MI_FILTER*/`), dentro del CTE adecuado.
2. Crea `_mi_predicate(ids)` en `db.py`.
3. Llama `sql.replace("/*MI_FILTER*/", _mi_predicate(...))` en `fetch_*`.
4. Acepta el filtro en el router (CSV `Query` + `_parse_int_csv`).
5. Inclúyelo en la cache key del router.

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

Uso `Annotated[T, Query(ge=..., le=...)]` en vez de los defaults:

```python
@router.get("/api/pts/{idPt}/arbol")
def get_arbol(
    idPt: int,
    ventana: Annotated[int, Query(ge=1, le=24)] = 3,
    fecha_max: Annotated[date | None, Query()] = None,
    ...
) -> ArbolPT:
```

- `Annotated[…, Query(...)]` es la sintaxis moderna (FastAPI ≥ 0.95).
- `ge`/`le` evita ventanas absurdas (ej. 1000 meses = query de 80 años).
- `date | None` parsea ISO `yyyy-mm-dd` automáticamente; valores inválidos → 422.
- Para listas CSV (ciudades, tipos_material, clases) usamos `Annotated[str | None, Query()]` + parsing manual con `_parse_int_csv`. Pydantic no maneja CSV nativos; si quieres tipado más estricto, puedes aceptar `list[int]` con `Query()` (FastAPI lo convierte si se repite el query param), pero el frontend actual usa CSV para que la URL quede legible.

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
PACKAGE_DIR = Path(__file__).resolve().parent
SQL_DIR = PACKAGE_DIR / "sql"
```

NO uses cwd-relative paths como `Path("sql")`. Si lanzas uvicorn desde otra carpeta (ej. desde la raíz del repo en lugar de `backend/`), `Path("sql")` se rompe. `Path(__file__).parent` siempre resuelve a la carpeta del archivo `config.py`.

`pyproject.toml` declara los `.sql` como package data:

```toml
[tool.setuptools.package-data]
rbom_api = ["sql/*.sql"]
```

Esto garantiza que `pip install` (sin `-e`) también los empaquete.
