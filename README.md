# Rastreabilidad BOM — App v2 (FastAPI + React Flow)

App web moderna para visualizar el árbol BOM netteado con WIP por proceso para
PTs con demanda activa.

- **Backend**: FastAPI 0.115 + pyodbc + pydantic v2 (Python 3.12)
- **Frontend**: React 18.3 + `@xyflow/react` 12 + Tailwind 3 + TanStack Query + zustand (Vite)
- **Deploy**: servicio Windows con `nssm` envolviendo `uvicorn`. El backend
  sirve el frontend buildeado como StaticFiles → un solo proceso, un solo puerto.

## Fuente de verdad

Contrato completo (queries SQL, algoritmo, modelos, 15 trampas, 8 tests):

`d:\Dev\Proyectos profesionales\Consultor EPS\docs\reportes\Rastreabilidad-arbol-bom-fuente-datos.md`

Plan general: `C:\Users\ARamos\.claude\plans\iremos-por-opci-n-c-federated-kahn.md`

## Estructura

```
.
├── backend/                          FastAPI + pyodbc
│   ├── src/rbom_api/
│   │   ├── domain/                   netteo.py, modelo.py, db.py
│   │   ├── routers/                  /health, /api/pts, /api/pts/{id}/arbol
│   │   ├── services/arbol_service.py orquestacion BD -> netteo
│   │   ├── sql/                      Q_listado.sql, Q_detalle.sql
│   │   ├── static/                   build del frontend (gitignored)
│   │   └── main.py                   app factory + StaticFiles mount
│   ├── tests/unit/test_netteo.py     8 tests del contrato (sin BD)
│   └── tests/e2e/test_arbol_real.py  4 tests contra BD real (marker e2e)
├── frontend/
│   ├── src/
│   │   ├── api/                      types, axios client, react-query hooks
│   │   ├── components/Canvas/        ArbolCanvas + PtNode + ComponentNode
│   │   ├── components/Sidebar/       FiltersHeader + PtTable
│   │   ├── components/Tabs.tsx       multi-PT con cache infinito
│   │   ├── lib/                      buildGraph, layout (dagre LR), layoutCache
│   │   └── store/useUiStore.ts       zustand: tabs, modo, filtros, ventana
└── scripts/
    ├── build.ps1                     compila frontend y lo copia a backend/static
    ├── dev-up.ps1 / dev-down.ps1     levanta backend+vite en background
    └── install-service.ps1           registra el backend como servicio NSSM
```

## Quickstart de desarrollo

Requisitos: Python 3.12, Node 20+, ODBC Driver 17 for SQL Server.

```powershell
# Backend
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
copy .env.example .env             # ajusta EPS_PASSWORD y demas
.\.venv\Scripts\python.exe -m pytest -m "not e2e" -v   # 8 unit tests verdes

# Frontend
cd ..\frontend
npm install
npm run typecheck

# Levantar ambos en background
cd ..
.\scripts\dev-up.ps1               # backend en :8000, frontend en :5173
# Para detener:
.\scripts\dev-down.ps1
```

Visita <http://localhost:5173> — el proxy de Vite envía `/api/*` y `/health`
al backend automáticamente.

## Tests

```powershell
cd backend

# Unitarios del netteo (sin BD)
.\.venv\Scripts\python.exe -m pytest -m "not e2e" -v

# e2e contra SQL Server EPS real
copy .env.test.example .env.test   # rellena credenciales
.\.venv\Scripts\python.exe -m pytest -m e2e -v
```

Para validar el caso del diagrama Excalidraw del usuario contra producción,
configura en `.env.test`:

```
RBOM_E2E_PT_ID=<idMaterial entero del PT 91711066-RA>
```

Sin ese id, el test del diagrama queda como `skipped`.

## Build de producción

```powershell
.\scripts\build.ps1
```

Esto compila el frontend (vite) y copia `frontend/dist` a
`backend/src/rbom_api/static`. Cuando uvicorn arranca detecta esa carpeta y
monta la SPA en `/`, sirviendo SPA + API en un solo proceso (`:8000`).

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn rbom_api.main:app --host 0.0.0.0 --port 8000
```

## Deploy como servicio Windows (NSSM)

Requisitos: NSSM en el PATH (`choco install nssm`). En PowerShell elevado:

```powershell
.\scripts\build.ps1                # SI no se ha buildeado aun
.\scripts\install-service.ps1
```

El script registra el servicio `RastreabilidadBom` con auto-start, redirige
stdout/stderr a `logs/` con rotación de 10 MB, y lo arranca. Para validar:

```powershell
nssm.exe status RastreabilidadBom
Invoke-RestMethod http://localhost:8000/health
```

Desinstalar:

```powershell
nssm.exe stop   RastreabilidadBom
nssm.exe remove RastreabilidadBom confirm
```

## Variables de entorno (backend)

| Variable | Default | Notas |
| --- | --- | --- |
| `EPS_SERVER` | `192.168.4.5` | host SQL Server |
| `EPS_DATABASE` | `EPS` | base de datos |
| `EPS_USER` / `EPS_PASSWORD` | — | obligatorias |
| `EPS_DRIVER` | `ODBC Driver 17 for SQL Server` | |
| `EPS_TIMEOUT` | `120` | segundos de conexión + query |
| `ALMACEN_WIP_PROCESO_ID` | `16` | id del proceso Almacen WIP — buffer virtual al final de cada intermedio |
| `ALMACEN_WIP_PROCESO_NOMBRE` | `Almacen WIP` | nombre visible |
| `DEV` | `false` | habilita CORS para Vite en :5173 |
| `LOG_LEVEL` | `info` | nivel structlog |

## Validación visual (PT canónico)

El caso del diagrama Excalidraw del usuario fue validado en producción contra
BD real con `chrome-devtools`:

- PT **91711066-RA** (Hood W, Rear Engine) — CNH Industrial — 222 pendientes
- Componente **90358715-RA** (Angle, Strut) — Parcial — `Doblez (4 de 218)` ✓
- Componente **91711040-RA** (Hood, Engine Rear) — Parcial — `Nivelado (0 de 213)` ✓ — `9 en buffer` en modo Inventario ✓

Coincidencia exacta con los `assert` del test `test_arbol_pt_canonico_cuadra_con_diagrama`.

## Para agentes / detalle técnico

Si vas a iterar sobre el código, lee primero [`CLAUDE.md`](./CLAUDE.md) — contiene la tabla "qué cargar para qué tarea" y reglas para no romper invariantes.

Detalle por subproyecto:

- **Backend**: [`backend/docs/`](./backend/docs)
  - [`architecture.md`](./backend/docs/architecture.md) — capas y módulos
  - [`data-flow.md`](./backend/docs/data-flow.md) — ciclo de una request
  - [`algoritmo-netteo.md`](./backend/docs/algoritmo-netteo.md) — contrato completo del algoritmo (autocontenido)
  - [`conventions.md`](./backend/docs/conventions.md) — decisiones no obvias (sync endpoints, env, cache, etc.)
  - [`testing.md`](./backend/docs/testing.md) — suites y comandos
- **Frontend**: [`frontend/docs/`](./frontend/docs)
  - [`architecture.md`](./frontend/docs/architecture.md) — capas, store, paleta
  - [`data-flow.md`](./frontend/docs/data-flow.md) — click → árbol render, cache de sesión
  - [`nodes-and-edges.md`](./frontend/docs/nodes-and-edges.md) — semántica visual del canvas
  - [`conventions.md`](./frontend/docs/conventions.md) — TanStack, layoutCache, proxy, types
  - [`testing.md`](./frontend/docs/testing.md) — typecheck, build, validación visual con chrome-devtools
