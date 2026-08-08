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

## Gobernanza de datos — este repo es un activo de `ezi-data-core`

Todo lo que este proyecto sabe sobre EPS (qué tabla, qué filtro, qué trampa) es
**doctrina compartida** con el repo de gobernanza de datos, no conocimiento
privado de esta app:

| | |
| --- | --- |
| Repo de gobernanza | `ezi-data-core` — clon local en `D:/Dev/Proyectos profesionales/Consultor EPS` ([github](https://github.com/AndresDRamos/ezi-data-core)) |
| Contrato de este activo | `activos/RastreabilidadBOM/` — manifiesto `activo.yaml`, `_index.md` y `decisiones.md` (D-01…D-04) |
| Slug | `rastreabilidad-wip` · estado **`certificado`** (6/6 checks verdes, 2026-08-03) |
| Activo hermano | `plan-capacidad` — mismo dominio (requerimiento, cobertura, netteo), motor distinto. Traducción y divergencias: `activos/RastreabilidadBOM/decisiones.md` D-06 |
| Checks de premisas | `validaciones/rastreabilidad-*.yaml` → `python validar.py --activo rastreabilidad-wip` |
| Recetas de origen | `docs/reportes/Rastreabilidad-{arbol-bom,bloques-proceso,ubicacion}.md` |

**Antes de escribir o modificar una query en `backend/src/rbom_api/sql/`, lee la
fuente correspondiente en `Consultor EPS/docs/fuentes/`** — `demanda.md`,
`produccion.md`, `embarques.md`, `materiales.md`, `rutas.md`,
`clientes-grupos.md`. Ahí viven las trampas medidas contra la BD real: la clase
NetSuit que cambia por cliente/ciudad, la demanda con `idMaterial` 0/NULL, los
universos de cliente por lista de IDs (nunca `LIKE`), el anti-join de remisión.

**La comunicación es en las dos direcciones.** Si descubres algo sobre EPS que
no está en `docs/fuentes/`, o encuentras que la doctrina está equivocada,
**corrige el data-core en el mismo cambio** — no lo dejes solo en un comentario
de esta app. Precedente fundacional (2026-08-03): el patrón anti-join que
publicaba `ezi-data-core` sobre-excluía el 21.6% del WIP y esta app tenía razón;
la corrección viajó de aquí hacia allá. Una divergencia sin registrar vuelve
invisible el próximo error de un quinto del inventario.

Cuando un cambio toque una **premisa** (no un resultado: un supuesto que la UI da
por cierto sin poder verlo), congélala como check en `validaciones/`. Los tests
de `backend/tests/` fijan el **algoritmo**; los checks fijan los **datos**. No se
sustituyen.

## Estructura del monorepo

```
Rastreabilidad-app/
├── AGENTS.md                  ← este archivo
├── README.md                  ← quickstart para humanos
├── listados/                  ← universos de filtrado: un CSV (ClaveMaterial, idMaterial)
│   ├── listados.json          ←   por cliente + manifiesto con slug y nombre visible
│   └── caterpillar.csv
├── backend/
│   ├── pyproject.toml
│   ├── src/rbom_api/
│   │   ├── main.py            ← app factory + middlewares + StaticFiles mount
│   │   ├── config.py          ← Settings (pydantic-settings) + SQL_DIR
│   │   ├── deps.py            ← Depends(get_conn): pyodbc fresh por request; universo_ids
│   │   ├── logging_setup.py   ← structlog + CorrelationIdMiddleware
│   │   ├── routers/           ← health, pts, listados, arbol, bloques, requerimiento, export
│   │   ├── services/          ← arbol_service (orquestación)
│   │   ├── domain/            ← modelo (pydantic), netteo (algoritmo), db (pyodbc)
│   │   ├── sql/               ← Q_listado, Q_detalle, Q_bloques, Q_pts_en_proceso, Q_plantas,
│   │   │                        Q_requerimiento_calendario, Q_orden_detalle
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
│   │   │   ├── Sidebar/       ← Sidebar + UniversoSelect + FiltersHeader + PtTable + ClienteCombobox + CiudadMultiSelect + ClaseMultiSelect + CalendarioPanel
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
| Cambiar un query SQL | **`Consultor EPS/docs/fuentes/<tema>.md` (la doctrina, primero)** → `backend/docs/data-flow.md` → `backend/src/rbom_api/sql/Q_*.sql` → `backend/src/rbom_api/domain/db.py` |
| Descubrir/corregir algo sobre EPS (tabla, filtro, trampa) | `Consultor EPS/docs/fuentes/_index.md` → la fuente del tema → corregirla ahí **y** en el código → si es una premisa, check en `Consultor EPS/validaciones/` |
| Entender por qué el WIP, la clase o el netteo son así | `Consultor EPS/activos/RastreabilidadBOM/decisiones.md` (D-01…D-04) |
| Tocar el filtro de clase NetSuit | `Consultor EPS/docs/fuentes/demanda.md` (§ ClassID) → el CTE `cteClase` en las 6 SQL que lo llevan → `domain/db.py` (`_clase_predicate`) |
| Agregar un placeholder de filtro a un query | `backend/docs/conventions.md` (sección placeholders) → `backend/src/rbom_api/domain/db.py` (`_*_predicate` + `_strip_param_declarations`) |
| Modificar el algoritmo de netteo | `backend/docs/algoritmo-netteo.md` (obligatorio) → `backend/src/rbom_api/domain/netteo.py` → `backend/tests/unit/test_netteo.py` |
| Tocar el requerimiento cross-PT (leyenda del nodo compartido) | `backend/docs/algoritmo-netteo.md` (§ CantidadEnsamble) → `backend/src/rbom_api/domain/universo_req.py` + `sql/Q_universo_req.sql` → `services/arbol_service.py` (`req_universo`, cache TTL) → `frontend/src/components/Canvas/nodes/ComponentNode.tsx` (`CompartidoLegend`) |
| Tocar la exportación a Excel | `backend/src/rbom_api/services/export_service.py` (definiciones de "Total WIP" / "Total completos") → `routers/export.py` → `backend/tests/unit/test_export.py` → `frontend/src/components/Tabs.tsx` (`ExportButton`) |
| Agregar un endpoint | `backend/docs/architecture.md` → `backend/docs/conventions.md` → `backend/src/rbom_api/routers/*.py` (mirar `pts.py` o `bloques.py` según necesites cache simple o multi-filtro) → `backend/src/rbom_api/main.py` para registrarlo |
| Cambiar modelo pydantic | `backend/src/rbom_api/domain/modelo.py` → `frontend/src/api/types.ts` (replicar) → `frontend/docs/conventions.md` |
| Variables de entorno | `backend/src/rbom_api/config.py` → `backend/.env.example` |
| Tests | `backend/docs/testing.md` → `backend/tests/...` |
| Modificar layout / posiciones del árbol | `frontend/docs/data-flow.md` → `frontend/src/lib/{layout,layoutCache,buildGraph}.ts` |
| Cambiar apariencia de un nodo | `frontend/docs/nodes-and-edges.md` → `frontend/src/components/Canvas/nodes/*.tsx` → `frontend/tailwind.config.ts` para colores |
| Tocar la vista Resumen | `frontend/docs/architecture.md` (sección Vista Resumen) → `frontend/src/components/Summary/SummaryView.tsx` → `backend/src/rbom_api/routers/bloques.py` |
| Tocar la vista Flujo (grafo de procesos) | `backend/src/rbom_api/sql/Q_flujo.sql` + `domain/db.py` (`fetch_flujo`) → `frontend/src/lib/buildFlujo.ts` → `frontend/src/components/Summary/{FlujoCanvas,FlujoProcessNode,FlujoEdge}.tsx` |
| Tocar la vista Calendario de requerimiento (panel expandible del sidebar) | `backend/src/rbom_api/sql/Q_requerimiento_calendario.sql` + `Q_orden_detalle.sql` → `backend/src/rbom_api/domain/db.py` (`fetch_requerimiento_calendario`, `fetch_orden_detalle`) → `routers/requerimiento.py` → `frontend/src/api/queries.ts` (`useRequerimientoCalendario`, `useOrdenDetalle`) → `frontend/src/components/Sidebar/CalendarioPanel.tsx` → `frontend/src/store/useUiStore.ts` (campos `sidebarExpanded`, `calGranularidad`, `calIncluyeForecast`, `calModo`, `celdaDetalle`). La celda es demanda BRUTA por fecha — NO nettea WIP (eso sigue viviendo en el árbol). |
| Tocar el historial de EMBARQUES del Calendario (fase 2; columnas azules a la izquierda del Past-due) | `backend/src/rbom_api/sql/Q_embarques_calendario.sql` + `Q_remision_detalle.sql` → `domain/db.py` (`fetch_embarques_calendario`, `fetch_remision_detalle`) → `routers/requerimiento.py` (`/embarques`, `/remision-detalle`) → `frontend/src/api/queries.ts` (`useEmbarquesCalendario`, `useRemisionDetalle`) → `frontend/src/components/Sidebar/CalendarioPanel.tsx` (eje unificado `[emb … | Esta semana | … req]`; el bucket actual es una columna `kind:"presente"` que consolida en franjas apiladas embarcado/past-due/requerimiento; `calModo`). Fuente: `EPS.dbo.vwRemisiones` con puentes Item_Id→idMaterial / Customer_Id→IdNetSuit / City→tblCiudad. Filas ANCLA = requerimiento; tope `MAX_FILAS=250`. |
| **Agregar un listado de críticos de un cliente** | `listados/` (deja el CSV + su entrada en `listados.json`). **No se toca código**: el backend descubre los listados por el manifiesto y el selector se puebla desde `GET /api/listados` |
| Tocar el mecanismo de universos (listados) | `listados/listados.json` → `backend/src/rbom_api/domain/universos.py` + `config.py` (`listados_manifiesto`) → `deps.py` (`universo_ids`) → `routers/listados.py` → `domain/db.py` (`_pt_universo_predicate`) → `frontend/src/components/Sidebar/UniversoSelect.tsx` + `store/useUiStore.ts` (`universo`) |
| Componente de carga / skeleton | `frontend/src/components/ui/Skeleton.tsx` (`Skeleton` / `NumberSkeleton`) |
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
- Extras posteriores ya consolidados en `main`:
  - **Vista Resumen** con bloques por `idProcesoSiguiente`, drill-down al árbol y filtros globales (cliente, planta, ciudades, tipo de material, clase NetSuit). Es la tab por defecto al abrir la app.
  - **WIP en 3 buckets** por proceso: Por procesar (alimenta el netteo), Liberadas (display) y En Inspección (display). El `ProcessNode` los muestra simultáneamente en una grilla 3×1.
  - **Multi-cliente PT**: si un PT tiene demanda activa para varios (cliente × ciudad), el algoritmo consolida en una sola card del PT raíz con la suma de demandas.
  - **Parámetro `fecha_max`** opcional en `/api/pts` y `/api/pts/{id}/arbol` para acotar el techo de la ventana de demanda (past-due sigue incluido).
  - **Expansión de procesos** como nodos en el canvas (chip "procesos" con icono de árbol en la cabecera de cards expandibles).
  - **Vista Flujo** (`GET /api/flujo` → `Q_flujo.sql`): grafo de procesos conectados (un bloque por `proceso × planta`, aristas `origen → destino`). La **estructura** sale de las rutas de fabricación (`tblMaterialRutaTiempo` + `LEAD`), incluye bloques/aristas **en cero**, y el WIP se **sobrepone** (LEFT JOIN). Toggle "Tarjetas ⇄ Flujo" en la cabecera del Resumen. `Disponibles(Y)` dentro del bloque = Σ aristas entrantes; la arista X→Y = `PorTransferir` de X hacia Y.
  - **Universos por listado de cliente** (param `universo=<slug>`): selector en el sidebar que acota listado + bloques + flujo + calendario a los `idMaterial` de un listado de números críticos. Los listados viven en `listados/` — un CSV `(ClaveMaterial, idMaterial)` por cliente más un manifiesto `listados.json` que les da **slug y nombre visible**—, y `GET /api/listados` los expone para poblar el selector. El backend los lee con `domain/universos.py` (cache por mtime del manifiesto **y** de cada CSV) e inyecta `/*PT_UNIVERSO_FILTER*/` en `cteDem` de cada query. Dar de alta un cliente nuevo **no toca código**.
    - **Un slug desconocido es 400, no "sin filtro"** (`deps.universo_ids`). Degradarlo devolvería toda la demanda aparentando que el filtro corrió — el fallo más caro posible en esta app.
    - `general` es un slug reservado: significa "sin filtro" y no puede usarlo un listado.
    - Un listado con `n_materiales = 0` (CSV faltante o vacío) **se sigue mostrando** en el selector, con aviso. Desaparecer sería indistinguible de "ese cliente no existe".
    - Historia: hasta ago-2026 esto era un universo único ("Caterpillar Priority") leído de `NumerosCriticos.csv` en la raíz, con un segmented control de dos pestañas (`UniversoTabs.tsx`, quitado en jul-2026). El CSV se migró a `listados/caterpillar.csv`.
  - **Vista Calendario de requerimiento** (corte 1; panel expandible del sidebar, `frontend/src/components/Sidebar/CalendarioPanel.tsx`): matriz PT × tiempo con la demanda **BRUTA** (sin nettear WIP — el neteo sigue viviendo solo en el árbol) desagregada por día vía `GET /api/requerimiento/calendario` (`Q_requerimiento_calendario.sql`). Columna Past-due fija + buckets día/semana/mes (toggle) con heatmap cercano-cálido → lejano-frío, forecast hachurado, fila Total. Clic en celda abre un popover inferior con el detalle de línea de orden vía `GET /api/requerimiento/orden-detalle` (`Q_orden_detalle.sql`: OrdenVenta, POHeader/POLine, Fecha, PiezasPend, Precio_Unitario). Grano de fila = (PT × Cliente × Ciudad), igual que `Q_listado.sql` — un mismo PT puede repetirse. Toggle lista ⇄ calendario es un tercer estado de ancho del sidebar (`useUiStore.sidebarExpanded`).
  - **Historial de embarques en el Calendario** (fase 2, entregada): columnas azules a la IZQUIERDA del Past-due con lo embarcado por periodo (la actual pegada al Past-due, hacia atrás), vía `GET /api/requerimiento/embarques` (`Q_embarques_calendario.sql`, fuente `EPS.dbo.vwRemisiones`). Toggle `calModo` (`"requerimiento" | "embarques" | "ambos"`, default "ambos"). Eje unificado `[emb … | Esta semana | … req]`, navegable con ◀▶ (mismo offset). **El bucket actual se consolida en una sola columna `kind:"presente"`** (en vez de 3): franjas apiladas embarcado (↑) / past-due (!) / requerimiento (●), cada una con su heatmap y su propio detalle. `colsEmb` excluye el bucket actual cuando `incluyeReq`; `colsReq` siempre lo excluye; ambos van a `presenteCol`. Clic en celda de embarque → detalle de remisiones vía `GET /api/requerimiento/remision-detalle` (`Q_remision_detalle.sql`). Puentes NetSuite→EPS: `Item_Id→idMaterial` (vía `tblDemandaEPS` activa, acota al universo de la demanda), `Customer_Id→tblCliente.IdNetSuit`, `City→tblCiudad` (best-effort, sin match → "(sin ciudad)"). Filas ANCLA = requerimiento (los embarques solo enriquecen; en modo embarques-puro sí crean fila); tope `MAX_FILAS=250` con aviso. Los folios de `vwRemisiones` vienen numéricos → CAST a varchar en el SQL.
  - **Conexión con `ezi-data-core`** (2026-08-03): el repo quedó registrado como activo
    `rastreabilidad-wip` con manifiesto, decisiones y 4 checks de premisas (4/4 verdes). En la
    auditoría se corrigieron tres cosas: la clase NetSuit pasa a `vwClassIDMaterial` (regla
    14), la demanda sin material deja de esconderse (regla 15) y el patrón anti-join **del
    data-core** se corrigió con lo que esta app ya hacía bien (regla 16). Ver la sección
    "Gobernanza de datos" arriba.
- Validado visualmente contra BD real con el **PT canónico 91711066-RA** (CNH Industrial, Hood W Rear Engine, 222 piezas pendientes):
  - `90358715-RA` muestra `Doblez (4 de 218)` en modo Requerimiento y `4 en piso` en modo Inventario.
  - `91711040-RA` muestra `Nivelado (0 de 213)` y `9 en piso`.

## Reglas para agentes (lee antes de cambiar código)

1. **NO `async def` en endpoints** — pyodbc bloquea. FastAPI corre los endpoints sync en threadpool, eso es lo correcto. Si necesitas async para algo, hazlo fuera del path de BD.
2. **NO crear un pool de pyodbc compartido entre threads** — pyodbc no es thread-safe entre conexiones. `Depends(get_conn)` abre una conexión nueva por request y la cierra al final. Es intencional.
3. **NO romper el contrato del netteo** — `pytest -m "not e2e"` (9 tests) debe quedar verde después de tus cambios. Los tests son el ground truth ejecutable del algoritmo.
4. **NO cambiar `extra="ignore"` en los modelos pydantic** — el schema de EPS evoluciona; los modelos deben tolerar columnas extra.
5. **NO mover el layout cache fuera de module-level** (`frontend/src/lib/layoutCache.ts`) — está ahí a propósito para sobrevivir el desmonte del canvas al cambiar de tab.
6. **NO cambiar las queryKeys del frontend sin alinear el cache** (el slug del
   universo — `general` o el de un listado — es la primera dimensión de los
   listados/Resumen/Flujo; por eso **un slug publicado no se renombra**: la
   caché vieja queda huérfana sin que nada falle):
   - `["arbol", idPt, ventana, fechaMax]` — `staleTime: Infinity` (cache de sesión).
   - `["pts", universo, ventana, fechaMax]` — `staleTime: 5 min` (espeja TTL backend).
   - `["bloques", universo, clientesKey, planta, ciudadesKey, tiposKey, clasesKey]` — `staleTime: 2 min`.
   - `["flujo", universo, clientesKey, planta, ciudadesKey, tiposKey, clasesKey]` — `staleTime: 2 min`.
   - `["flujo-plantas", universo, clientesKey, ciudadesKey, tiposKey, clasesKey]` — `staleTime: 2 min` (overview nivel planta, sin filtro de planta).
   - `["pts-en-proceso", universo, idProceso, clientesKey, planta, ciudadesKey, tiposKey, clasesKey]` — `staleTime: 2 min`.
   - `["etiquetas-detalle", universo, idProceso, bucket, destino, clientesKey, planta, ciudadesKey, tiposKey, clasesKey]` — `staleTime: 2 min`.
   - `["plantas"]` — `staleTime: 10 min`.
   - `["listados"]` — `staleTime: 10 min` (opciones del selector de universo; cambia solo al editar `listados/`).
   - `["requerimiento-cal", universo, ventana, fechaMax]` — `staleTime: 5 min` (espeja TTL backend, igual que `pts`). Alimenta el panel Calendario; cliente/ciudad/forecast/granularidad se resuelven client-side sobre el mismo result-set, sin re-fetch.
   - `["orden-detalle", idMaterial, cliente, ciudad, desde, hasta, forecast]` — `staleTime: 2 min` (popover de detalle de una celda de requerimiento del Calendario).
   - `["embarques-cal", universo, mesesAtras]` — `staleTime: 5 min` (fase 2 del Calendario: historial de embarques, columnas azules a la IZQUIERDA del Past-due). Cliente/ciudad/pt/granularidad se resuelven client-side sobre el mismo result-set, sin re-fetch.
   - `["remision-detalle", idMaterial, cliente, ciudad, desde, hasta]` — `staleTime: 2 min` (popover de detalle de una celda de EMBARQUE: líneas de remisión).
7. **Si tocas `backend/src/rbom_api/domain/modelo.py`, replica en `frontend/src/api/types.ts`** — es el espejo TypeScript y no hay validación cruzada automática. Idea futura: generar con `openapi-typescript` desde `/openapi.json`.
8. **Antes de borrar un PasoRuta virtual** lee `backend/docs/algoritmo-netteo.md` — el buffer virtual (`Almacen WIP`, idProceso=16) es parte del contrato del netteo: su `wip_en_paso` entra en `wip_total` y en el acumulado downstream de `req_paso`. Ya no alimenta la card directamente (desde 2026-07 muestra `wip_total` / `req_neto`), pero borrarlo **cambiaría los números**, no solo la UI.
9. **Alimentan el netteo `Disponibles + Recibidas + EnInspeccionSig`** (todo lo que aún debe *entrar* al proceso). `liberadas`, `en_inspeccion` (la de **salida**, keyed por `idProcesoUlt`) y `retrabajo` son display puro. **[2026-08-03]** `en_inspeccion_sig` —estatus POR INSPECCION keyed por `idProcesoSiguiente`— se sumó al netteo: la huella FIFO del CLR muestra que ese estatus aporta el 4% de las asignaciones con 99.5% de acierto, y con él el pool coincide con el del activo `plan-capacidad` (497,574 pzs). Si introduces una métrica nueva desde el WIP, decide explícitamente si descuenta demanda y refleja la decisión en `domain/netteo.py` + un test que la fije.
9-bis. **`tblBomExplosionado.CantidadEnsamble` viene ACUMULADA desde el PT raíz**, no es local padre→hijo. El netteo la convierte con `_cantidad_local` (divisor = fila con `IdBom == IdBomParent`, **nunca** `cantidad_ensamble_total[padre]`). Tratarla como local re-aplica el factor del padre en cada nivel — bug real que reportaba 918 piezas donde correspondían 0. Ver `backend/docs/algoritmo-netteo.md` § "Semántica de CantidadEnsamble".
9-ter. **El WIP compartido se reparte FIFO entre los PT que lo reclaman.** *[2026-08-04]*
    `universo_req.repartir_wip_fifo` asigna a cada PT su cuota —el más vencido primero, sin
    prorratear, misma regla que el CLR y que `plan-capacidad`— y `arbol_service` recorta el
    WIP del árbol a esa cuota antes de netear. **Consecuencia: la suma de los árboles ya
    CUADRA con el netteo del universo**; hasta 2026-08-03 no cuadraban a propósito porque
    cada árbol se atribuía el 100% del WIP, y 9 de cada 10 PT de un componente compartido
    mostraban "0 por fabricar" siendo falso (medido: 689 pares PT×componente afectados,
    82,986 pzs de requerimiento invisible).
    - `NodoComponente.wip_total` = la **cuota** de este PT (la que descuenta `req_neto`).
    - `NodoComponente.wip_fisico` = las piezas **en piso**, sin repartir. La card muestra
      "0 de 15,172 en piso" y el badge dice "Asignado a otros" en vez de "Sin WIP".
    - El reparto es por **PT**, no por línea de demanda (el CLR va línea a línea); dentro de
      un PT sus líneas comparten el lote asignado.
    - El reparto por proceso es **proporcional** al WIP de cada paso: conserva el total sin
      alterar la forma de la cadena. Igualar al CLR (que consume por planta×proceso) exige
      traer el WIP del universo desagregado por proceso.
    - Si el reparto falla, `armar_arbol` cae al comportamiento anterior (100% del WIP) y lo
      registra: un árbol optimista es más útil que un error.
    Fijado por `test_fifo_*` en `tests/unit/test_universo_req.py`.
10. **Si agregas un parámetro `DECLARE` nuevo a una `.sql`**, agrégalo al stripping de `_strip_param_declarations` en `backend/src/rbom_api/domain/db.py`, o SQL Server fallará con `variable already declared`.
11. **Los placeholders `/*FILTRO*/` en las SQL del Resumen se reemplazan por string-substitution**: los `_*_predicate` de `db.py` validan cada id como `int(...)` antes de armar el `IN (...)`. Si agregas un placeholder nuevo, sigue ese patrón y NO concatenes strings del usuario directamente.
12. **Los feedback de carga**: no dejar como primer estado un "0", ni un estado en blanco como inicial, sobretodo si es un número que aún está esperando los cálculos, utilizar un componente de carga.
13. **Las columnas consolidadas del Excel son definiciones de negocio, no cálculos libres.** Viven en `services/export_service.py` y las fija `tests/unit/test_export.py`: *Total WIP* = `wip_total` (para un kit, unidades ya ensambladas = kits completos en piso); *Total completos* = `wip_en_paso` del **último paso de la ruta** del componente (donde esperan las piezas que ya recorrieron todo lo anterior); *Requerimiento neto* = `req_neto`. Si cambias una definición, cambia su test — el planner toma decisiones de producción con esas columnas.
13-bis. **"Total completos" se deriva de la ESTRUCTURA de la ruta, sin idProceso hardcodeados.** Dos trampas que por eso evita: (a) NO es el WIP del último proceso de *fabricación* — por la trampa #10, `wip_en_paso[X]` son piezas esperando **entrar** a X, así que las del último proceso son justo las que aún NO terminaron (en el canónico esa lectura daría 4 para `90358715-RA` y 0 para `91711040-RA`, invertido). (b) NO se suma por lista `{13,16}`: `idProceso=16` es el **primer** paso real en los PT que arrancan con ARMADO DE KITS, no el buffer final. El último paso de la ruta resuelve ambos casos: para intermedios es el buffer virtual `Almacen WIP`, para el PT su último proceso catalogado. Fijado por `test_total_completos_*`.

14. **La clase NetSuit sale de `EPS.dbo.vwClassIDMaterial`, nunca de `NETSUITE.dbo.ITEMS`.**
    La clase NO es global del item: vive al grano **(idMaterial, idCliente, idCiudad)** — el
    mismo material se clasifica distinto según a quién y a dónde se vende. Las 6 SQL que la
    tocan llevan un CTE `cteClase` idéntico con `ROW_NUMBER ... rn = 1`: **el dedup no es
    defensivo**, la vista admite >1 fila por las tres llaves y sin él el `SUM` de piezas se
    infla por fan-out. Fijado por el check `rastreabilidad-clase-sin-fanout`.
15. **`tblDemandaEPS.idMaterial` admite `0` y `NULL`** — son líneas de demanda **reales** sin
    material catalogado. En el **listado** y el **calendario** (demanda bruta) se etiquetan
    con `bSinMaterial = 1` y siguen contando; un `INNER JOIN` a `tblMaterial` las escondía en
    silencio. En el **árbol** y el **flujo** el `INNER JOIN` sí es correcto: parten del BOM,
    que exige material. Fijado por el check `rastreabilidad-demanda-sin-material`.
16. **El anti-join de remisión va contra `EPS.dbo.vwEtiquetasEnRemision`** (≡ remisión a
    cliente, `idTipoDestino = 1`), **no** contra toda `tblRemisionEtiquetaDetalle`. Una
    etiqueta remisionada a otra planta o a maquila **no salió del sistema: se movió**, y sigue
    siendo WIP. El patrón sin ese filtro borra 108,272 pzs (21.6% del WIP activo). Fijado por
    el check `rastreabilidad-antijoin-tipodestino`.

17. **`faltante` es la carga del proceso; `req_paso` NO.** El `PasoRuta` publica los dos, y
    el `ProcessNode` muestra **`faltante`** (etiqueta "a procesar") desde 2026-08-03:
    - `faltante[i]` = `req_bruto − Σ wip[k]` para `k = i+1…último` (**exclusivo**) — lo que
      ese proceso tiene que procesar, **incluidas las piezas que ya esperan en él**. Es la
      columna `Piezas` del CapacidadDetalle y del activo `plan-capacidad`.
    - `req_paso[i]` = lo mismo pero **inclusivo** — lo que aún *no ha llegado*. Alimenta el
      netteo aguas arriba y sigue decidiendo el color "cubierto".

    La diferencia es exactamente `wip_en_paso[i]`, así que `faltante = req_paso + wip_en_paso`
    (capado a `req_bruto`). Fijado por `test_equivalencia_faltante_plan_capacidad`.

18. **La demanda de esta app y la del `CapacidadDetalle` CUADRAN (ratio 1.000).** No hay
    sobreestimación: `tblDemandaEPS` da 3,661,142 pzs y `fnDemandaEPS` da 3,661,059 sumando
    sus **dos** lados. En `fnDemandaEPS` el signo de `IdDemandaEps` **no separa demanda real
    de inventada: separa "aún sin programar" (`>0`) de "ya programada por el planeador"
    (`<0`, la demanda interna)**. Filtrar por el signo para "comparar solo cliente" descarta
    una mitad y fabrica una diferencia del 33% que no existe — pasó el 2026-08-03 y está
    documentado como D-07 en `activos/RastreabilidadBOM/decisiones.md`.
    **Para comparar contra el CapacidadDetalle hacen falta tres cosas**: incluir la demanda
    interna, **deduplicar por recurso** (el CSV repite las piezas idénticas en cada recurso
    del mismo proceso y solo reparte las horas → tomar el máximo, no la suma) y alinear el
    techo de fecha. Con eso y la traducción de la regla 17, coinciden en el **94.3%** de los
    pasos (ratio agregado 0.993).

## Convenciones de los documentos

- Cada archivo en `*/docs/` arranca con una línea **"cuándo cargar este archivo"** para que el agente decida en 5 segundos si lo necesita.
- Rutas siempre relativas a la raíz del repo (`backend/src/rbom_api/...`), nunca absolutas.
- Nombres de función/variable citados exactos para que sean `grep`-eables.
- Diagramas en ASCII en bloques de código (sin lenguaje o con `text`). Funcionan en terminal, GitHub e IDE sin renderer.
- Si dudas entre marcar algo como "regla dura" o como "estado actual", márcalo. El proyecto sigue evolucionando — un dato que hoy es contrato (ej. "solo Por procesar alimenta netteo") puede dejar de serlo, y eso debe ser fácil de detectar al releer.
