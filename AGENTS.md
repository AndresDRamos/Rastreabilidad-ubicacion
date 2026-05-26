# AGENTS.md — Rastreabilidad BOM (monorepo)

Punto de entrada para agentes. Si abres una sesión nueva en este repo, **lee este archivo primero** y después solo lo que necesites de `backend/docs/` o `frontend/docs/` según la tarea.

## Qué es esto

App web interna para entender el WIP del piso de fábrica desde dos ángulos:

1. **Vista Resumen** — tarjetas agregadas por `idProcesoSiguiente`: piezas y etiquetas que esperan entrar a cada proceso, filtrables por cliente, planta, ciudad, tipo de material y clase NetSuit. Sirve la pregunta "¿dónde está mi inventario en curso?".
2. **Vista Árbol** — árbol BOM **netteado** (demanda menos WIP) de un PT con demanda activa en SQL Server EPS (192.168.4.5). Cruza 4 fuentes — demanda, BOM explosionado, rutas de fabricación y WIP por proceso — y produce un grafo dirigido hijo → padre renderizado con React Flow. Sirve la pregunta "¿qué me falta fabricar para cubrir este pedido?".

El árbol responde dos sub-modos operativos (toggle puro en frontend, sin refetch):

- **Inventario** — piezas ya en piso por componente y por proceso.
- **Requerimiento** — piezas que aún debo fabricar.

Las dos vistas se cruzan: clickeando un bloque del Resumen → la sidebar filtra los PTs cuyos componentes esperan ese proceso, y al abrir uno de esos PTs el árbol auto-expande y resalta los `ProcessNode` que matchean.

Stack:

- Backend: **FastAPI 0.115 + pyodbc + pydantic v2** (Python 3.12), single-process. Endpoints `def` (sync), pyodbc bloquea, FastAPI lo corre en threadpool.
- Frontend: **React 18.3 + @xyflow/react 12 + Tailwind 3 + TanStack Query + zustand** (Vite 5.4).
- Deploy: el frontend buildeado se copia a `backend/src/rbom_api/static/` y uvicorn sirve SPA + API en un solo puerto (`:8000`). En producción Windows el wrapper es `nssm`.

## Estructura del monorepo

```
Rastreabilidad-app/
├── AGENTS.md                  ← este archivo
├── README.md                  ← quickstart para humanos
├── backend/
│   ├── pyproject.toml
│   ├── src/rbom_api/
│   │   ├── main.py            ← app factory + middlewares + StaticFiles mount
│   │   ├── config.py          ← Settings (pydantic-settings) + SQL_DIR
│   │   ├── deps.py            ← Depends(get_conn): pyodbc fresh por request
│   │   ├── logging_setup.py   ← structlog + CorrelationIdMiddleware
│   │   ├── routers/           ← health, pts, arbol, bloques
│   │   ├── services/          ← arbol_service (orquestación)
│   │   ├── domain/            ← modelo (pydantic), netteo (algoritmo), db (pyodbc)
│   │   ├── sql/               ← Q_listado, Q_detalle, Q_bloques, Q_pts_en_proceso, Q_plantas
│   │   └── static/            ← bundle del frontend (gitignored)
│   ├── tests/unit/            ← 9 tests sintéticos del netteo
│   ├── tests/e2e/             ← 4 tests contra BD real (marker `e2e`)
│   └── docs/                  ← detalle backend (5 archivos)
├── frontend/
│   ├── package.json
│   ├── vite.config.ts         ← proxy /api y /health → :8000, alias @
│   ├── tailwind.config.ts     ← paleta status (covered/partial/empty/pt/neutral)
│   ├── src/
│   │   ├── App.tsx, main.tsx
│   │   ├── api/               ← types (espejo pydantic), client (axios baseURL=/api), queries (TanStack)
│   │   ├── store/useUiStore.ts ← zustand: view, filtros, selectedPtIds, activeTabId, mode, expanded, procesoFiltro
│   │   ├── components/
│   │   │   ├── Canvas/        ← ArbolCanvas + 3 nodos custom (PtNode/ComponentNode/ProcessNode) + PartThumbnail + EmptyState
│   │   │   ├── Sidebar/       ← Sidebar + FiltersHeader + PtTable + ClienteCombobox + CiudadMultiSelect + ClaseMultiSelect
│   │   │   ├── Summary/       ← SummaryView (vista Resumen) + TipoMaterialSelect
│   │   │   ├── Tabs.tsx       ← tab "Resumen" fija + un tab por PT abierto
│   │   │   └── ModeToggle.tsx
│   │   └── lib/               ← buildGraph, layout, layoutCache, format
│   └── docs/                  ← detalle frontend (5 archivos)
└── scripts/                   ← build.ps1, dev-up.ps1, dev-down.ps1, install-service.ps1
```

## Qué cargar para qué tarea

| Tarea | Archivos a leer (en orden) |
| --- | --- |
| Cambiar un query SQL | `backend/docs/data-flow.md` → `backend/src/rbom_api/sql/Q_*.sql` → `backend/src/rbom_api/domain/db.py` |
| Agregar un placeholder de filtro a un query | `backend/docs/conventions.md` (sección placeholders) → `backend/src/rbom_api/domain/db.py` (`_*_predicate` + `_strip_param_declarations`) |
| Modificar el algoritmo de netteo | `backend/docs/algoritmo-netteo.md` (obligatorio) → `backend/src/rbom_api/domain/netteo.py` → `backend/tests/unit/test_netteo.py` |
| Agregar un endpoint | `backend/docs/architecture.md` → `backend/docs/conventions.md` → `backend/src/rbom_api/routers/*.py` (mirar `pts.py` o `bloques.py` según necesites cache simple o multi-filtro) → `backend/src/rbom_api/main.py` para registrarlo |
| Cambiar modelo pydantic | `backend/src/rbom_api/domain/modelo.py` → `frontend/src/api/types.ts` (replicar) → `frontend/docs/conventions.md` |
| Variables de entorno | `backend/src/rbom_api/config.py` → `backend/.env.example` |
| Tests | `backend/docs/testing.md` → `backend/tests/...` |
| Modificar layout / posiciones del árbol | `frontend/docs/data-flow.md` → `frontend/src/lib/{layout,layoutCache,buildGraph}.ts` |
| Cambiar apariencia de un nodo | `frontend/docs/nodes-and-edges.md` → `frontend/src/components/Canvas/nodes/*.tsx` → `frontend/tailwind.config.ts` para colores |
| Tocar la vista Resumen | `frontend/docs/architecture.md` (sección Vista Resumen) → `frontend/src/components/Summary/SummaryView.tsx` → `backend/src/rbom_api/routers/bloques.py` |
| Agregar / cambiar un filtro del Resumen | `frontend/src/store/useUiStore.ts` (campo `filters`) → `frontend/src/components/Sidebar/*MultiSelect.tsx` → `frontend/src/api/queries.ts` (`useBloques` + `usePtsEnProceso`) → `backend/src/rbom_api/routers/bloques.py` + `Q_bloques.sql` + `Q_pts_en_proceso.sql` |
| Drill-down Resumen → árbol | `frontend/docs/data-flow.md` (sección drill-down) → `frontend/src/components/Canvas/ArbolCanvas.tsx` (auto-expand + highlight) → `frontend/src/lib/buildGraph.ts` (`HighlightFiltro`) |
| Tabs / cache de sesión | `frontend/docs/conventions.md` (sección staleTime + layoutCache) → `frontend/src/components/Tabs.tsx` → `frontend/src/lib/layoutCache.ts` |
| Toggle Inventario/Requerimiento | `frontend/docs/nodes-and-edges.md` → `frontend/src/store/useUiStore.ts` (campo `mode`) → cada `*Node.tsx` |
| Filtros del listado | `frontend/src/components/Sidebar/{FiltersHeader,PtTable}.tsx` → `frontend/src/store/useUiStore.ts` (campo `filters`) |
| Build/deploy producción | `README.md` (sección deploy) → `scripts/build.ps1` → `scripts/install-service.ps1` |
| Debug "Login failed" / conexión BD | `backend/.env` + `backend/.env.test` → `backend/docs/conventions.md` (sección env file) |

## Comandos esenciales

```powershell
# Dev (ambos en background)
.\scripts\dev-up.ps1                  # backend :8000 + vite :5173
.\scripts\dev-down.ps1                # detiene ambos

# Tests
cd backend
.\.venv\Scripts\python.exe -m pytest -m "not e2e" -v       # 9 unit, sin BD
.\.venv\Scripts\python.exe -m pytest -m e2e -v             # 4 e2e, requiere .env.test

# Frontend (sin dev server)
cd frontend
npm run typecheck                     # único gate estable
npm run build                         # bundle a frontend/dist

# Producción (un solo proceso)
.\scripts\build.ps1                   # copia frontend/dist → backend/src/rbom_api/static
cd backend
.\.venv\Scripts\python.exe -m uvicorn rbom_api.main:app --host 0.0.0.0 --port 8000
```

## Estado del proyecto

- M1–M7 del plan original completados y validados.
- Extras posteriores ya consolidados en `master`:
  - **Vista Resumen** con bloques por `idProcesoSiguiente`, drill-down al árbol y filtros globales (cliente, planta, ciudades, tipo de material, clase NetSuit). Es la tab por defecto al abrir la app.
  - **WIP en 3 buckets** por proceso: Por procesar (alimenta el netteo), Liberadas (display) y En Inspección (display). El `ProcessNode` los muestra simultáneamente en una grilla 3×1.
  - **Multi-cliente PT**: si un PT tiene demanda activa para varios (cliente × ciudad), el algoritmo consolida en una sola card del PT raíz con la suma de demandas.
  - **Parámetro `fecha_max`** opcional en `/api/pts` y `/api/pts/{id}/arbol` para acotar el techo de la ventana de demanda (past-due sigue incluido).
  - **Expansión de procesos** como nodos en el canvas (chip "procesos" con icono de árbol en la cabecera de cards expandibles).
- Validado visualmente contra BD real con el **PT canónico 91711066-RA** (CNH Industrial, Hood W Rear Engine, 222 piezas pendientes):
  - `90358715-RA` muestra `Doblez (4 de 218)` en modo Requerimiento y `0 en buffer` en modo Inventario.
  - `91711040-RA` muestra `Nivelado (0 de 213)` y `9 en buffer`.

## Reglas para agentes (lee antes de cambiar código)

1. **NO `async def` en endpoints** — pyodbc bloquea. FastAPI corre los endpoints sync en threadpool, eso es lo correcto. Si necesitas async para algo, hazlo fuera del path de BD.
2. **NO crear un pool de pyodbc compartido entre threads** — pyodbc no es thread-safe entre conexiones. `Depends(get_conn)` abre una conexión nueva por request y la cierra al final. Es intencional.
3. **NO romper el contrato del netteo** — `pytest -m "not e2e"` (9 tests) debe quedar verde después de tus cambios. Los tests son el ground truth ejecutable del algoritmo.
4. **NO cambiar `extra="ignore"` en los modelos pydantic** — el schema de EPS evoluciona; los modelos deben tolerar columnas extra.
5. **NO mover el layout cache fuera de module-level** (`frontend/src/lib/layoutCache.ts`) — está ahí a propósito para sobrevivir el desmonte del canvas al cambiar de tab.
6. **NO cambiar las queryKeys del frontend sin alinear el cache**:
   - `["arbol", idPt, ventana, fechaMax]` — `staleTime: Infinity` (cache de sesión).
   - `["pts", ventana, fechaMax]` — `staleTime: 5 min` (espeja TTL backend).
   - `["bloques", cliente, planta, ciudadesKey, tiposKey, clasesKey]` — `staleTime: 2 min`.
   - `["pts-en-proceso", idProceso, cliente, planta, ciudadesKey, tiposKey, clasesKey]` — `staleTime: 2 min`.
   - `["plantas"]` — `staleTime: 10 min`.
7. **Si tocas `backend/src/rbom_api/domain/modelo.py`, replica en `frontend/src/api/types.ts`** — es el espejo TypeScript y no hay validación cruzada automática. Idea futura: generar con `openapi-typescript` desde `/openapi.json`.
8. **Antes de borrar un PasoRuta virtual** lee `backend/docs/algoritmo-netteo.md` — el buffer virtual (`Almacen WIP`, idProceso=16) es parte del contrato y alimenta el valor de la card del componente.
9. **Solo el bucket "Por procesar" alimenta el netteo**. `liberadas` y `en_inspeccion` son display puro. Si introduces una nueva métrica desde el WIP, decide explícitamente si descuenta demanda y refleja la decisión en `domain/netteo.py` + un test que la fije.
10. **Si agregas un parámetro `DECLARE` nuevo a una `.sql`**, agrégalo al stripping de `_strip_param_declarations` en `backend/src/rbom_api/domain/db.py`, o SQL Server fallará con `variable already declared`.
11. **Los placeholders `/*FILTRO*/` en las SQL del Resumen se reemplazan por string-substitution**: los `_*_predicate` de `db.py` validan cada id como `int(...)` antes de armar el `IN (...)`. Si agregas un placeholder nuevo, sigue ese patrón y NO concatenes strings del usuario directamente.

## Convenciones de los documentos

- Cada archivo en `*/docs/` arranca con una línea **"cuándo cargar este archivo"** para que el agente decida en 5 segundos si lo necesita.
- Rutas siempre relativas a la raíz del repo (`backend/src/rbom_api/...`), nunca absolutas.
- Nombres de función/variable citados exactos para que sean `grep`-eables.
- Diagramas en ASCII en bloques de código (sin lenguaje o con `text`). Funcionan en terminal, GitHub e IDE sin renderer.
- Si dudas entre marcar algo como "regla dura" o como "estado actual", márcalo. El proyecto sigue evolucionando — un dato que hoy es contrato (ej. "solo Por procesar alimenta netteo") puede dejar de serlo, y eso debe ser fácil de detectar al releer.
