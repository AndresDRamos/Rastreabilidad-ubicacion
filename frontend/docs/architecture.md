# frontend/docs/architecture.md

> Cuándo cargar: cuando entres por primera vez al frontend, vayas a agregar un componente nuevo, o necesites saber dónde vive cada responsabilidad.

## Capas

```
                       ┌──────────────────────┐
                       │       App.tsx        │
                       │  layout 2 columnas   │
                       └──────────┬───────────┘
                                  │
              ┌───────────────────┴───────────────────┐
              ▼                                       ▼
    ┌──────────────────┐                  ┌──────────────────────┐
    │   Sidebar/       │                  │      Canvas/         │
    │  FiltersHeader   │                  │  Tabs + ModeToggle   │
    │  PtTable         │                  │  ArbolCanvas         │
    └─────────┬────────┘                  └──────────┬───────────┘
              │                                      │
              │ click PT                             │ click nodo
              ▼                                      ▼
       ┌─────────────────────────────────────────────────┐
       │           store/useUiStore (zustand)            │
       │  filters · selectedPtIds · activeTabId          │
       │  mode · expanded · ventana                      │
       └─────────────────────┬───────────────────────────┘
                             │ activeTabId
                             ▼
                ┌─────────────────────────┐
                │   api/queries.ts        │  useArbol(idPt, ventana)
                │   TanStack Query        │  usePts(ventana)
                └─────────────┬───────────┘
                              │ axios → /api/...
                              ▼
                ┌─────────────────────────┐
                │   lib/buildGraph        │  ArbolPT → nodes + edges
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
| `App.tsx` | Layout: Sidebar (`w-[360px]`) + Canvas. Lógica: `idPt = activeTabId ?? selectedPtIds[0]`. Si no hay PT seleccionado → `<EmptyState />`. |
| `index.css` | Tailwind directives + scrollbars custom. |
| `vite-env.d.ts` | Tipos vite. |
| `api/types.ts` | Tipos espejo de los modelos pydantic del backend. Más `Mode = "inventario" \| "requerimiento"`. |
| `api/client.ts` | axios instance: `baseURL = ""` (queries usan rutas relativas, proxy las redirige). |
| `api/queries.ts` | `usePts(ventana)`: `staleTime: 5min`. `useArbol(idPt, ventana)`: `staleTime: Infinity`, `gcTime: Infinity` (cache de sesión). |
| `store/useUiStore.ts` | Zustand store. Única fuente de verdad de UI. |
| `components/Sidebar/Sidebar.tsx` | Header + FiltersHeader + PtTable. |
| `components/Sidebar/FiltersHeader.tsx` | 3 inputs: cliente, ciudad, numero de parte. Escribe a `useUiStore.filters`. |
| `components/Sidebar/PtTable.tsx` | Lee `usePts(ventana)`, filtra por `filters`, ordena por `PiezasPastDue DESC`, `PiezasPend DESC`. Click → `togglePt(idMaterial)`. |
| `components/Tabs.tsx` | Renderiza un tab por cada `selectedPtIds`. Click → `setActiveTab`. X → `closeTab` + `dropCachedLayoutByPt`. |
| `components/ModeToggle.tsx` | Botones "Requerimiento" / "Inventario" → `setMode`. |
| `components/Canvas/EmptyState.tsx` | Placeholder cuando no hay PT activo. |
| `components/Canvas/ArbolCanvas.tsx` | Hook query → buildGraph → layout cache → ReactFlow. `onNodeClick` → `toggleExpanded`. |
| `components/Canvas/nodes/PtNode.tsx` | Card 240px, borde azul. Valor según `mode`: `wipTotal` (inv) vs `piezasPend` (req). |
| `components/Canvas/nodes/ComponentNode.tsx` | Card 240px, borde según status. Valor según `mode`: `wipBuffer` vs `reqBufferFaltante`. |
| `components/Canvas/nodes/ProcessNode.tsx` | Card 180px (más compacta). Valor según `mode`: `wipEnPaso` vs `reqPaso`. |
| `lib/buildGraph.ts` | `buildGraph(arbol, expanded) → {nodes, edges}`. Decide qué nodos emitir (cards + pasos si expandido) y cómo conectar edges. |
| `lib/layout.ts` | `layoutLR(nodes, edges, opts)` — wrapper de dagre con `rankdir: "LR"`. |
| `lib/layoutCache.ts` | Map module-level keyed por `${idPt}\|${expanded_ordenado}`. Sobrevive desmonte. |
| `lib/format.ts` | `fmtInt`, `fmtNum`. |
| `vite.config.ts` | Alias `@` → `src/`. Proxy `/api` y `/health` a `localhost:8000`. Port 5173. |
| `tailwind.config.ts` | Paleta custom: `surface`, `ink`, `status` (covered/partial/empty/pt/neutral). Shadows `card`, `soft`. |
| `tsconfig.json` | Strict mode + `paths: { "@/*": ["src/*"] }`. |
| `index.html` | Title "Rastreabilidad BOM", favicon SVG inline (4 cuadros azul). |

## El store (`useUiStore.ts`) — único contrato de UI

Es **la** fuente de verdad de la UI. Si un componente necesita compartir estado, ponlo aquí, no en otro lado.

```ts
interface UiState {
  filters: { cliente: string; ciudad: string; pt: string };
  selectedPtIds: number[];
  activeTabId: number | null;
  ventana: number;                  // meses, default 3
  mode: "inventario" | "requerimiento";
  expanded: Set<number>;            // idComp expandidos (PT también)

  // Mutadores
  setFilter(key, value);
  setVentana(n);
  togglePt(idMaterial);             // agrega/quita de selectedPtIds + setea activeTabId
  closeTab(idMaterial);             // remueve de selectedPtIds; reasigna activeTabId
  setActiveTab(idMaterial);
  clearSelection();
  setMode(mode);
  toggleExpanded(idComp);
}
```

### Reglas del store

- **`selectedPtIds` y `activeTabId` se mueven juntos**. `togglePt` los sincroniza. Nunca los manipules por separado desde fuera.
- **`expanded` es global a todos los PTs** (no por tab). Si abres dos tabs y expandes el mismo `idComp`, ambos canvas lo muestran expandido. Esto es intencional para mantener consistencia visual.
- **`mode` es global**. Cambiarlo afecta todos los canvas montados. Re-render puro, sin refetch ni re-layout.
- **`filters` es solo del listado** (sidebar). No se envía al backend; el filtrado es client-side en `PtTable.tsx`.

## `api/types.ts` — invariante con el backend

El archivo refleja 1:1 los modelos pydantic de `backend/src/rbom_api/domain/modelo.py`:

| Pydantic (backend) | TypeScript (frontend) |
| --- | --- |
| `FilaListado` | `FilaListado` |
| `DemandaPT` | `DemandaPT` |
| `PasoRuta` | `PasoRuta` |
| `AristaPadre` | `AristaPadre` |
| `NodoComponente` | `NodoComponente` |
| `ArbolPT` | `ArbolPT` |

**Invariante**: si cambias un campo en el backend, debes replicarlo aquí. No hay generador automático. Si tienes muchos cambios pendientes considera generar tipos desde el `openapi.json` (FastAPI lo expone en `/openapi.json`).

`Mode = "inventario" | "requerimiento"` es propio del frontend, no existe en el backend.

## Estilos (`tailwind.config.ts`)

Paleta semántica, no por color:

| Token | Uso |
| --- | --- |
| `surface-muted`, `surface-subtle`, `surface-border` | Fondos y bordes neutros. |
| `ink`, `ink-muted`, `ink-subtle` | Jerarquía de texto. |
| `status-pt` | Azul del PT raíz. |
| `status-covered` | Verde: componente cubierto (req_paso último <= 0). |
| `status-partial` | Naranja: parcial (tiene WIP pero falta). |
| `status-empty` | Rojo: sin WIP y con demanda. |
| `status-neutral` | Gris: sin demanda. |

Si necesitas un color nuevo, agrégalo al `tailwind.config.ts` con nombre semántico (`status-warning`, no `yellow-500`).

## Lo que NO está en el frontend

- **Sin router**. Single page, sin URLs por PT. Si se quisiera "permalink a un PT", habría que agregar `react-router` y reflejar `selectedPtIds` + `activeTabId` en query params.
- **Sin tests automatizados**. Sólo typecheck + build manual + validación visual (ver `testing.md`).
- **Sin SSR**. Es SPA pura servida desde uvicorn.
- **Sin auth client-side**. El backend está detrás de red interna; el frontend asume que cualquier visitante está autorizado.
- **Sin i18n**. Hardcoded en español.
