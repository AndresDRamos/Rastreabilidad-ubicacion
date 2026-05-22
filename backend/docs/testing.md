# backend/docs/testing.md

> Cuándo cargar: cuando vayas a agregar/modificar tests, o cuando una corrida de tests esté fallando y necesites entender la estructura de fixtures.

## Dos suites, dos marcadores

| Suite | Carpeta | Tests | BD? | Marker | Comando |
| --- | --- | --- | --- | --- | --- |
| Unit (contrato del netteo) | `tests/unit/` | 8 | NO | (sin marker) | `pytest -m "not e2e"` |
| E2E (contra BD real) | `tests/e2e/` | 4 | SÍ (192.168.4.5) | `@pytest.mark.e2e` | `pytest -m e2e` |

`pyproject.toml` registra el marker:

```toml
[tool.pytest.ini_options]
markers = [
    "e2e: requiere BD EPS real (192.168.4.5)",
]
```

## Unit tests — el contrato del netteo

`tests/unit/test_netteo.py` contiene los 8 tests que definen el comportamiento del algoritmo. Son **el ground truth ejecutable**: si tocas `domain/netteo.py`, estos tests deben seguir verdes.

| Test | Verifica |
| --- | --- |
| `test_caso_canonico_req_neto` | Pasada 1: `req_bruto[C] = sum(req_neto[padre]·cant)` y `req_neto[C] = max(0, req_bruto - wip_total)`. Caso de 4 componentes Cp/Cb/Ca/Cc. |
| `test_componente_compartido_suma_req_bruto` | Componente shared (Ca aparece bajo Cp y bajo Cb): `req_bruto` suma ambas contribuciones (1×3 + 1×2 = 5). |
| `test_req_paso_ruta_inversa` | Pasada 2: para Ca con 2 pzs en buffer y `req_bruto=2`, todos los `req_paso = 0` (totalmente cubierto). |
| `test_req_paso_caso_diagrama_usuario` | **Caso canónico Excalidraw** sin BD: PT 222 piezas, 90358715 con 4 en Doblez → `req_paso=218`; 91711040 con 9 en buffer → `req_paso=213` en todos los pasos. |
| `test_pt_no_tiene_nodo_virtual` | El PT raíz NO recibe el paso virtual `Almacen WIP` al final de su ruta. |
| `test_falla_sin_demanda` | `construir_arbol(demanda_filas=[], ...)` lanza `ValueError("Sin filas de demanda...")`. |
| `test_agrupacion_pasos_por_idProceso` | 3 sub-pasos con el mismo `idProceso=6` (Soldadura Robot/Limpieza/Manual) colapsan en 1 `PasoRuta`. El WIP se cuenta una sola vez. |
| `test_advertencia_wip_fuera_ruta` | WIP de Ca con `idProcesoSiguiente=99` (proceso no listado en su ruta) genera una advertencia. |

**Datos sintéticos**: helpers `_demanda(req_pt)`, `_bom()`, `_rutas()`, `_wip_caso_ejemplo()`. IDs ficticios (CP=100, CB=200, CA=300, CC=400). No tocan SQL Server.

## E2E tests — contra `192.168.4.5`

`tests/e2e/test_arbol_real.py` aplica `pytestmark = pytest.mark.e2e` a todo el módulo. Si no hay `.env.test`, los tests se **skipean** automáticamente con mensaje claro.

| Test | Qué valida |
| --- | --- |
| `test_health_ok` | `GET /health` responde 200 y `db_ok=true`. |
| `test_listado_contiene_pts_con_demanda` | `GET /api/pts?ventana=3` devuelve ≥1 PT con `PiezasPend>0` y schema correcto. |
| `test_arbol_pt_canonico_cuadra_con_diagrama` | (Skip si `RBOM_E2E_PT_ID` no está en `.env.test`) Verifica el caso del diagrama: `Doblez.req_paso == 218` para `90358715-RA`, `Doblez.req_paso == 213` para `91711040-RA`. |
| `test_arbol_devuelve_ambos_valores_por_paso` | Cada `PasoRuta` en el response incluye `wip_en_paso` Y `req_paso` (el toggle Inventario/Requerimiento depende de esto). |

## Fixtures del e2e (`tests/e2e/conftest.py`)

### `settings` (scope=session)

```python
@pytest.fixture(scope="session")
def settings() -> Settings:
    if not ENV_TEST.exists():
        pytest.skip(f".env.test no encontrado en {ENV_TEST}. ...")
    for line in ENV_TEST.read_text(encoding="utf-8").splitlines():
        # parsing custom que respeta comentarios inline (" #")
        ...
        os.environ[k.strip()] = _parse_dotenv_value(raw_v)
    get_settings.cache_clear()    # ← invalida el singleton
    return get_settings()
```

**Punto crítico**: `get_settings()` fue invocado al importar `rbom_api.main` (que ejecuta `app = create_app()` al final). Esa primera instancia se cacheó con `@lru_cache`. Sin `cache_clear()`, las vars del `.env.test` se ignoran.

El parser custom (`_parse_dotenv_value`) maneja:
- Comentarios inline tipo `EPS_USER=foo # admin de tests`.
- Quotes envolventes `EPS_PASSWORD="hola # mundo"` (preserva el `#` interno).

### `conn` (scope=session)

```python
@pytest.fixture(scope="session")
def conn(settings: Settings) -> pyodbc.Connection:
    try:
        c = pyodbc.connect(settings.conn_string, timeout=settings.timeout)
    except pyodbc.Error as exc:
        pytest.skip(f"No se pudo conectar a SQL Server EPS: {exc}")
    yield c
    c.close()
```

Una sola conexión para toda la sesión de tests e2e. Si la BD está caída → skip, no failure (no quieres flapping rojo en CI).

### `client` (scope=session)

`TestClient` de FastAPI. Llama a `create_app()` directamente (sin uvicorn), pero el `app` ya importado tiene los settings viejos. Por eso `settings.cache_clear()` es obligatorio antes.

## Comandos típicos

```powershell
cd backend

# Todo unit, sin BD
.\.venv\Scripts\python.exe -m pytest -m "not e2e" -v

# Solo e2e
.\.venv\Scripts\python.exe -m pytest -m e2e -v

# Un solo test
.\.venv\Scripts\python.exe -m pytest tests/unit/test_netteo.py::test_req_paso_caso_diagrama_usuario -v

# Con coverage
.\.venv\Scripts\python.exe -m pytest -m "not e2e" --cov=rbom_api --cov-report=term-missing
```

## Variable opcional `RBOM_E2E_PT_ID`

El test `test_arbol_pt_canonico_cuadra_con_diagrama` necesita el `idMaterial` (int) del PT `91711066-RA` para hacer `GET /api/pts/{idPt}/arbol`. Como ese id es específico de la BD, **no se hardcodea**; se lee de la env:

```env
# .env.test
RBOM_E2E_PT_ID=<idMaterial entero>
RBOM_E2E_PT_CLAVE=91711066-RA
RBOM_E2E_COMP1_CLAVE=90358715-RA
RBOM_E2E_COMP1_REQ_DOBLEZ=218
RBOM_E2E_COMP2_CLAVE=91711040-RA
RBOM_E2E_COMP2_REQ_DOBLEZ=213
```

Sin `RBOM_E2E_PT_ID`, el test se skipea con mensaje claro.

Para descubrir el id, conectado a la BD:

```sql
SELECT idMaterial FROM EPS.dbo.tblMaterial WHERE ClaveMaterial = '91711066-RA';
```

## Convenciones para tests nuevos

- **Unit tests del netteo**: agrégalos a `tests/unit/test_netteo.py` con los helpers existentes (`_demanda`, `_bom`, `_rutas`, `_wip_caso_ejemplo`). Usa IDs ficticios distintos para no chocar.
- **Tests de routers**: usa `TestClient` con `dependency_overrides[get_conn]` para mockear la conexión. Aún no hay ejemplos, pero el patrón es:

```python
from rbom_api.main import create_app
from rbom_api.deps import get_conn

def fake_conn():
    yield MockConnection()

app = create_app()
app.dependency_overrides[get_conn] = fake_conn
client = TestClient(app)
```

- **Tests e2e nuevos**: aplica `pytestmark = pytest.mark.e2e` al módulo. Si depende de un PT específico, lee el id de env y haz `pytest.skip` si no está.

## Smoke check post-cambio

Antes de marcar un cambio del backend como hecho:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -m "not e2e" -v
```

8 verdes obligatorios. Si tocaste algo crítico:

```powershell
.\.venv\Scripts\python.exe -m pytest -m e2e -v
```

Con `.env.test` configurado, esperar 3 verdes + 1 skipped (o 4 verdes si tienes `RBOM_E2E_PT_ID`).
