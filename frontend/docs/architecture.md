# frontend/docs/architecture.md

> Cuándo cargar: cuando entres por primera vez al frontend, vayas a agregar un componente nuevo, o necesites saber dónde vive cada responsabilidad.

## Dos vistas, un layout

La app tiene **dos vistas** que se intercambian en el mismo canvas central:

- **`view = "summary"`** — pestaña fija "Resumen" con tarjetas agregadas de WIP por proceso destino. Es la vista por defecto al cargar la app.
- **`view = "tree"`** — un PT abierto en una tab, con el árbol BOM netteado renderizado en React Flow.

Las dos vistas se cruzan:

1. Clickeas un bloque en Resumen → `procesoFiltro` se setea → la sidebar (`PtTable`) intersecta con `usePtsEnProceso(idProceso)` y muestra solo los PTs que esperan ese proceso, con un badge "N en {proceso}".
2. Abres uno de esos PTs → `view = "tree"` → `ArbolCanvas` recibe `procesoFiltro` como `HighlightFiltro`, auto-expande los componentes que matchean el filtro y resalta los `ProcessNode` correspondientes con un ring azul.

## Capas

```text
                       ┌──────────────────────┐
                       │       App.tsx        │
                       │  layout 2 columnas   │
                       │  view: summary|tree  │
                       └──────────┬───────────┘
                                  │
              ┌───────────────────┴───────────────────┐
              ▼                                       ▼
    ┌──────────────────┐                  ┌──────────────────────┐
    │   Sidebar/       │                  │  Tabs + ModeToggle   │
    │  FiltersHeader   │                  ├──────────────────────┤
    │  PtTable         │            ┌─────┤ Summary/SummaryView  │
    │  (paginada)      │            │     │   ó                  │
    └─────────┬────────┘            │     │ Canvas/ArbolCanvas   │
              │                     │     └──────────┬───────────┘
              │ click PT            │                │
              │ togglePt()          │                │ click bloque
              ▼                     │                │ setProcesoFiltro()
       ┌─────────────────────────────────────────────────┐
       │           store/useUiStore (zustand)            │
       │  view · filters · selectedPtIds · activeTabId   │
       │  mode · expanded · ventana · procesoFiltro      │
       └─────────────────────┬───────────────────────────┘
                             │
                             ▼
                ┌─────────────────────────┐
                │   api/queries.ts        │  usePts, useArbol
                │   TanStack Query        │  useBloques, usePtsEnProceso, usePlantas
                └─────────────┬───────────┘
                              │ axios → /api/... (baseURL="/api")
                              ▼
                ┌─────────────────────────┐
                │   lib/buildGraph        │  ArbolPT → nodes + edges (+ highlight)
                │   lib/layout (dagre LR) │  posiciona
                │   lib/layoutCache       │  cache module-level
                └─────────────┬───────────┘
                              │
                              ▼
                ┌─────────────────────────┐
                │   @xyflow/react         │  ReactFlow + custom nodes
                │   PtNode · ComponentNode│
                │   ProcessNode           │
                └─────────────────────────┘
```

## Inventario por archivo (`frontend/src/`)

| Archivo | Responsabilidad |
| --- | --- |
| `main.tsx` | Entry point. Crea `QueryClient` (`refetchOnWindowFocus: false`, `retry: 1`), provee a `<App />`. |
| `App.tsx` | Layout: Sidebar + main. En main: Tabs + (si `view==="tree"`) ModeToggle + (Canvas o SummaryView). |
| `index.css` | Tailwind directives + scrollbars custom. |
| `vite-env.d.ts` | Tipos vite. |
| `api/types.ts` | Tipos espejo de los modelos pydantic del backend: `FilaListado`, `DemandaPT`, `PasoRuta`, `AristaPadre`, `NodoComponente`, `ArbolPT`, `BloqueProceso`, `PTEnProceso`, `Planta`, `Mode`. |
| `api/client.ts` | Axios instance con `baseURL = "/api"` (queries usan rutas tipo `/pts`, `/bloques`, etc., y Vite/uvicorn las resuelven). |
| `api/queries.ts` | Hooks TanStack: `usePts`, `useArbol`, `useBloques`, `usePtsEnProceso`, `usePlantas`. Cada uno con su `staleTime` apropiado (ver `conventions.md`). |
| `store/useUiStore.ts` | Zustand store. Única fuente de verdad de UI — incluye `view`, `filters` (cliente/ciudades/pt/fechaMax/planta/tiposMaterial/clases), tabs, modo, expanded, `procesoFiltro`. |
| `components/Sidebar/Sidebar.tsx` | Header + FiltersHeader + PtTable. Colapsable (`w-[360px]` ↔ `w-8`). |
| `components/Sidebar/FiltersHeader.tsx` | `ClienteCombobox` + `CiudadMultiSelect` + `ClaseMultiSelect` + input texto PT + input date `fechaMax`. |
| `components/Sidebar/ClienteCombobox.tsx` | Combobox que deriva sus opciones de `usePts` (clientes que aparecen en el listado). Almacena `clienteId: number | null`. |
| `components/Sidebar/CiudadMultiSelect.tsx` | Multi-select de ciudades; si hay `clienteId`, restringe a las ciudades de ese cliente. |
| `components/Sidebar/ClaseMultiSelect.tsx` | Multi-select de Clase NetSuit (catálogo global del item). Quita auto-clases huérfanas si cambia el universo. |
| `components/Sidebar/PtTable.tsx` | Lee `usePts(ventana, fechaMax)`, filtra client-side, **pagina (25/pp)**. Cuando hay `procesoFiltro`, llama `usePtsEnProceso(...)`, intersecta el listado y lo ordena por piezasEnProceso descendente, con badge "N en {proceso}" en cada row. |
| `components/Tabs.tsx` | Pestaña fija "Resumen" + un tab por cada `selectedPtIds`. Click tab → `setActiveTab` (o `showSummary`). X → `closeTab` + `dropCachedLayoutByPt`. |
| `components/ModeToggle.tsx` | Botones "Requerimiento" / "Inventario" → `setMode`. Solo visible cuando `view==="tree"`. |
| `components/Summary/SummaryView.tsx` | Vista Resumen: header con totales + `PlantaSelect` + `TipoMaterialSelect` + chips de filtros activos. Grid de bloques (ProcessBlock) cliclables que setean `procesoFiltro`. |
| `components/Summary/TipoMaterialSelect.tsx` | Toggle "PT / Intermedio" (id 1 / 3). Multi-select. |
| `components/Canvas/EmptyState.tsx` | Placeholder cuando no hay PT activo (uso limitado ahora que el default es Resumen). |
| `components/Canvas/ArbolCanvas.tsx` | Hook query → buildGraph (con `HighlightFiltro` derivado de `procesoFiltro` + `plantaId` + `tipoMaterialIds`) → layout cache → ReactFlow. Auto-expande componentes que matchean el filtro. Panel top-right con botones "Expandir todo" / "Colapsar todo". |
| `components/Canvas/nodes/PtNode.tsx` | Card 240px, borde azul. Valor según `mode`: `wipTotal` (inv) vs `piezasPend` (req). Thumbnail de la pieza. |
| `components/Canvas/nodes/ComponentNode.tsx` | Card 240px, borde según status. Valor según `mode`: `wipBuffer` vs `reqBufferFaltante`. Thumbnail. Muestra `×{cantPadre}` si > 1. |
| `components/Canvas/nodes/ProcessNode.tsx` | Card 220px. Muestra **3 métricas simultáneamente** (Por procesar / Liberadas / En Inspección) — son independientes del toggle Inv/Req. Anillo azul si `highlighted=true`. |
| `components/Canvas/nodes/PartThumbnail.tsx` | Lazy-load de JPG en `http://192.168.4.5/Dibujos/normal/{clave}.jpg` con placeholder SVG. |
| `lib/buildGraph.ts` | `buildGraph(arbol, expanded, highlight?) → {nodes, edges}`. Decide qué nodos emitir, qué edges trazar, y marca `highlighted=true` en los process nodes que matchean el `HighlightFiltro`. |
| `lib/layout.ts` | `layoutLR(nodes, edges, opts)` — wrapper de dagre con `rankdir: "LR"`. |
| `lib/layoutCache.ts` | Map module-level keyed por `${idPt}\|${expanded_ordenado}`. Sobrevive desmonte. |
| `lib/format.ts` | `fmtInt`, `fmtNum`, `fmtPlanta` (`5 → "Externo"`, otros → `"Planta N"`). |
| `vite.config.ts` | Alias `@` → `src/`. Proxy `/api` y `/health` a `localhost:8000`. Port 5173. |
| `tailwind.config.ts` | Paleta custom: `surface`, `ink`, `status` (covered/partial/empty/pt/neutral). Shadows `card`, `soft`. |
| `tsconfig.json` | Strict mode + `paths: { "@/*": ["src/*"] }`. |
| `index.html` | Title "Rastreabilidad BOM", favicon SVG inline. |

## El store (`useUiStore.ts`) — único contrato de UI

Es **la** fuente de verdad de la UI. Si un componente necesita compartir estado, ponlo aquí, no en otro lado.

```ts
interface UiState {
  // Vista
  view: "summary" | "tree";

  // Tabs / selección
  selectedPtIds: number[];           // orden = orden de tabs
  activeTabId: number | null;
  ventana: number;                   // meses, default 3

  // Drill-down desde Resumen
  procesoFiltro: { idProceso: number; nombre: string } | null;

  // Modo de visualización
  mode: "inventario" | "requerimiento";
  expanded: Set<number>;             // idComp expandidos en el canvas

  // Filtros globales (se aplican a Resumen y a PtTable)
  filters: {
    clienteId: number | null;
    ciudadIds: number[];
    pt: string;                      // búsqueda parcial client-side
    fechaMax: string;                // ISO yyyy-mm-dd
    plantaId: number | null;
    tipoMaterialIds: number[];       // PT=1, Intermedio=3
    claseIds: number[];              // NetSuit CLASS_ID_ARTCULO_ID
  };

  // Mutadores: showSummary, togglePt, closeTab, setActiveTab, setMode,
  //            toggleExpanded, setExpanded, setFilter, setVentana,
  //            setProcesoFiltro, clearSelection
}
```

### Reglas del store

- **`selectedPtIds`, `activeTabId` y `view` se mueven juntos**. `togglePt`/`closeTab`/`setActiveTab` los sincronizan: al abrir un PT → `view="tree"`; al cerrar el último o ir a Resumen → `view="summary"`. Nunca los manipules por separado.
- **`togglePt` SÍ cierra el tab** si el id ya está seleccionado (decisión revertida respecto a la versión M5; ahora click-en-PT-seleccionado lo deselecciona).
- **`expanded` es global a todos los PTs** (no por tab). Si abres dos tabs y expandes el mismo `idComp`, ambos canvas lo muestran expandido. Esto es intencional para mantener consistencia visual.
- **`mode` es global**. Cambiarlo afecta todos los canvas montados. Re-render puro, sin refetch ni re-layout.
- **`filters` aplica a ambas vistas**:
  - Resumen: `clienteId`, `plantaId`, `ciudadIds`, `tipoMaterialIds`, `claseIds` viajan al backend (`useBloques`, `usePtsEnProceso`).
  - Sidebar: `clienteId`, `ciudadIds`, `pt` filtran client-side la tabla. `fechaMax` se manda a `/api/pts` y `/api/pts/{id}/arbol`.
  - Árbol: `plantaId` + `tipoMaterialIds` se combinan con `procesoFiltro` para armar el `HighlightFiltro`.
- **`procesoFiltro` se setea solo desde el bloque del Resumen**. Las chips del header del Resumen permiten removerlo. Cerrar el tab activo NO lo limpia (intencional: si cambias de PT mantienes el filtro).

## `api/types.ts` — invariante con el backend

El archivo refleja 1:1 los modelos pydantic de `backend/src/rbom_api/domain/modelo.py`:

| Pydantic (backend) | TypeScript (frontend) |
| --- | --- |
| `FilaListado` (incluye `idClase`, `Clase`) | `FilaListado` |
| `DemandaPT` | `DemandaPT` |
| `PasoRuta` (3 buckets WIP) | `PasoRuta` |
| `AristaPadre` | `AristaPadre` |
| `NodoComponente` | `NodoComponente` |
| `ArbolPT` | `ArbolPT` |
| `BloqueProceso` | `BloqueProceso` |
| `PTEnProceso` | `PTEnProceso` |
| `Planta` | `Planta` |

**Invariante**: si cambias un campo en el backend, debes replicarlo aquí. No hay generador automático. Si tienes muchos cambios pendientes considera generar tipos desde el `openapi.json` (FastAPI lo expone en `/openapi.json`) con `openapi-typescript`.

`Mode = "inventario" | "requerimiento"` y los `Data` de cada nodo (`PtNodeData`, `ComponentNodeData`, `ProcessNodeData` en `lib/buildGraph.ts`) son propios del frontend, no existen en el backend.

## Estilos (`tailwind.config.ts`)

Paleta semántica, no por color:

| Token | Uso |
| --- | --- |
| `surface`, `surface-muted`, `surface-subtle`, `surface-border` | Fondos y bordes neutros. |
| `ink`, `ink-muted`, `ink-subtle` | Jerarquía de texto. |
| `status-pt` | Azul del PT raíz / chips de filtro activo. |
| `status-covered` | Verde: componente cubierto / métrica "Por procesar" del ProcessNode. |
| `status-partial` | Naranja: parcial / métrica "En Inspección". |
| `status-empty` | Rojo: sin WIP y con demanda. |
| `status-neutral` | Gris: sin demanda. |

Si necesitas un color nuevo, agrégalo al `tailwind.config.ts` con nombre semántico (`status-warning`, no `yellow-500`).

## Vista Resumen — detalle estructural

`components/Summary/SummaryView.tsx` orquesta:

1. **Header** con totales (procesos, etiquetas, piezas) calculados in-memory sobre `useBloques(...)`.
2. **Filtros locales del Resumen**: `PlantaSelect` y `TipoMaterialSelect` (los demás filtros vienen del store global).
3. **Chips de filtros activos** (`FilterChip`) con botón ✕ que llama `setFilter(...)` para limpiar uno solo.
4. **Grid responsive de bloques** (`ProcessBlock`). Cada bloque:
   - Muestra `Piezas` como número grande, `Etiquetas`/`Componentes`/`Plantas` como meta.
   - Click → `setProcesoFiltro({idProceso, nombre})` o lo deselecciona si ya estaba activo.
   - Bloques con `idProceso === null` (raros) salen deshabilitados.

Cuando el usuario abre un PT desde la sidebar (`togglePt`), el `procesoFiltro` queda activo y el `ArbolCanvas` lo recibe vía store.

## Lo que NO está en el frontend

- **Sin router**. Single page, sin URLs por PT ni por filtro. Si se quisiera "permalink a una vista", habría que agregar `react-router` y reflejar el store en query params.
- **Sin tests automatizados**. Sólo typecheck + build + validación visual (ver `testing.md`).
- **Sin SSR**. Es SPA pura servida desde uvicorn.
- **Sin auth client-side**. El backend está detrás de red interna; el frontend asume que cualquier visitante está autorizado.
- **Sin i18n**. Hardcoded en español.
- **Sin reactividad ante cambios de BD**: las queries no se invalidan automáticamente cuando un operador modifica WIP. El usuario tendría que recargar el tab o esperar que expire el `staleTime` y trigger refetch.
