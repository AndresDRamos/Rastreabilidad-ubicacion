# frontend/docs/data-flow.md

> Cuándo cargar: cuando vayas a tocar `ArbolCanvas.tsx`, `SummaryView.tsx`, `buildGraph.ts`, `layoutCache.ts`, o cuando un cambio de UI no se vea reflejado y necesites trazar de dónde sale cada valor.

## Boot inicial — vista por defecto = Resumen

```text
[1] main.tsx monta <App/>
       │
       ▼
[2] useUiStore inicial:
       view: "summary"
       selectedPtIds: []
       activeTabId: null
       filters: { ... todos en valores neutros ... }
       │
       ▼
[3] App.tsx:
       render <Sidebar/> + <Tabs/> + <SummaryView/>
       │
       ▼
[4] SummaryView:
       useBloques(clienteId, plantaId, ciudadIds, tipoMaterialIds, claseIds)
           → GET /api/bloques (sin filtros)
           → grid de tarjetas
[5] Sidebar:
       usePts(ventana, fechaMax)
           → GET /api/pts?ventana=3
           → PtTable (paginada)
```

## Click en un PT desde la sidebar → árbol renderizado

```text
[1] Usuario click en una fila del PtTable
        │
        ▼
[2] PtTable.tsx llama  useUiStore.togglePt(fila.idMaterial)
        │
        ▼
[3] store muta:
       selectedPtIds: [..., idPt]
       activeTabId:   idPt
       view:          "tree"
        │
        ▼
[4] App.tsx re-renderiza:
       <Tabs/> + <ModeToggle/> + <ArbolCanvas key={idPt} idPt={idPt}/>
       <ArbolCanvas key={idPt}>  ← key fuerza nuevo monte por PT
        │
        ▼
[5] ArbolCanvasInner ejecuta:
       const { data, isLoading } = useArbol(idPt, ventana, fechaMax)
       const highlight = procesoFiltro
            ? { idProceso, idPlanta: plantaId, idsTipoMaterial: tipoMaterialIds }
            : null
        │
        ▼
[6] TanStack Query:
       queryKey = ["arbol", idPt, ventana, fechaMaxParam ?? null]
       ¿cached?  SÍ  → devuelve data inmediatamente (staleTime: Infinity)
                 NO  → fetch /api/pts/{idPt}/arbol?ventana={N}&fecha_max={...}
        │
        ▼
[7] backend (sync) → ArbolPT JSON
        │
        ▼
[8] Si highlight existe, calcular idsAExpandir (componentes que matchean
    proceso + planta + tipo). Disparar useEffect que extiende `expanded`
    con esos ids — solo la primera vez por combinación (PT, proceso, planta,
    tipos), tracked en autoExpandedKeyRef.
        │
        ▼
[9] useMemo recalcula layoutResult:
       (a) const { nodes, edges } = buildGraph(data, expanded, highlight)
       (b) key = `${idPt}|${expanded_ordenado_por_id}`
       (c) cache hit?  SÍ → reusar posiciones del cache
                       NO → layoutLR(nodes, edges) con dagre → guardar en cache
        │
        ▼
[10] useEffect:
       setNodes(layoutResult.nodes)
       setEdges(layoutResult.edges)
       setTimeout 50ms → fitView({ padding: 0.2, duration: 300 })
        │
        ▼
[11] ReactFlow renderiza nodos custom (PtNode, ComponentNode, ProcessNode)
     cada nodo lee `mode` del store directamente
     los ProcessNode con highlighted=true reciben ring azul + bg
```

`<ArbolCanvas key={idPt}>` en App.tsx: la `key` cambia al cambiar de tab, lo cual fuerza desmonte/monte completo del canvas. **Pero el `layoutCache` es module-level**, así que las posiciones persisten — solo el componente React vuelve a montarse, no los datos.

## Drill-down: Resumen → árbol con auto-expand y highlight

```text
[A] Usuario en SummaryView clickea un ProcessBlock (ej. idProceso=4 "Doblez")
        │
        ▼
[B] setProcesoFiltro({ idProceso: 4, nombre: "Doblez" })
        │
        ├─► Sidebar (PtTable):
        │       useEffect detecta procesoFiltro, dispara
        │       usePtsEnProceso(4, clienteId, plantaId, ciudadIds, tipoIds, claseIds)
        │       → GET /api/bloques/4/pts?...
        │       → intersección de PTs visibles + badge "N en Doblez"
        │       → orden DESC por piezasEnProceso
        │
        ▼
[C] Usuario click en un PT de la lista filtrada → togglePt(idMaterial)
        │
        ▼
[D] ArbolCanvas se monta:
       highlight = { idProceso: 4, idPlanta: plantaId, idsTipoMaterial: tipoIds }
       idsAExpandir = componentes con un PasoRuta no-virtual
                        donde idProceso === 4
                              (+ idPlanta y tipo match si aplican)
       autoExpandedKeyRef.current ≠ key actual → unión con `expanded` actual
        │
        ▼
[E] buildGraph(data, expanded, highlight) emite los ProcessNode marcando
    highlighted=true en los que matchean. ProcessNode aplica
    ring-2 ring-status-pt/40 + bg-status-pt/10 en el header.
```

**Por qué `idsAExpandir` con `autoExpandedKeyRef`**: queremos que la primera vez que entras a "Doblez" → el árbol se expanda solo en los Doblez. Pero si el usuario colapsa manualmente, NO queremos re-expandir al volver. El `ref` retiene la última combinación auto-expandida (`${idPt}|${idProceso}|${idPlanta ?? "x"}|${tiposKey}`) y solo dispara cuando cambia.

## Caso especial 1: toggle de modo Inventario/Requerimiento

```text
[1] click en <ModeToggle/>
       │
       ▼
[2] store.setMode("inventario")
       │
       ▼
[3] PtNode / ComponentNode re-renderizan
   (cada uno suscrito a useUiStore(s => s.mode))
       │
       ▼
[4] Cada nodo recalcula su número grande
   (PtNode: piezasPend vs wipTotal,
    ComponentNode: reqBufferFaltante vs wipBuffer)
```

**NO se refetchea** (useArbol no se vuelve a llamar).
**NO se re-layoutea** (layoutResult solo depende de `data`, `idPt`, `expanded`, `highlight`; no de `mode`).
**El cambio es re-render puro** en los nodos. Costo O(nodos visibles).

**El `ProcessNode` ya NO depende del `mode`** — siempre muestra las 3 métricas (Por procesar / Liberadas / En Inspección) en una grilla. El toggle Inv/Req solo afecta las cards (PtNode y ComponentNode).

Esto es posible porque el backend devuelve todos los valores en cada `PasoRuta`: `wip_en_paso`, `req_paso`, `liberadas`, `en_inspeccion`. El frontend elige cuál mostrar dónde.

## Caso especial 2: toggle expand de un componente

```text
[1] click en una card de PT o ComponentNode
       │
       ▼
[2] ArbolCanvas.onNodeClick:
       if (node.type === "pt" || node.type === "component"):
         if (node.data.expandable):
           toggleExpanded(idComp ?? idPt)
       │
       ▼
[3] store muta expanded: Set<number>
       │
       ▼
[4] useMemo de layoutResult re-ejecuta (depende de expanded)
       │
       ▼
[5] buildGraph(data, expanded, highlight) emite N nodos process nuevos
   + redirige edges hijos→padre al primer paso real del padre
       │
       ▼
[6] keyFor(idPt, expanded) genera key nueva
   → cache miss (esa combinación no se había layouteado)
   → layoutLR re-corre → setCachedLayout
       │
       ▼
[7] setNodes(...) → ReactFlow anima el delta
```

También hay botones "Expandir todo" / "Colapsar todo" en el Panel top-right del canvas que llaman `setExpanded(expandableIds)` o `setExpanded([])`.

**El cache es por combinación `(idPt, expanded)`**, así que si colapsas y vuelves a expandir el mismo set, las posiciones son las mismas que la última vez (perfecto para "deshacer mentalmente").

## Caches y staleTime resumen

```ts
// frontend/src/api/queries.ts

usePts(ventana, fechaMax)          → staleTime: 5 * 60_000     // 5 min
useArbol(idPt, ventana, fechaMax)  → staleTime: Infinity,       // cache de sesión
                                     gcTime:    Infinity
useBloques(...)                    → staleTime: 2 * 60_000     // 2 min
usePtsEnProceso(...)               → staleTime: 2 * 60_000     // 2 min
usePlantas()                       → staleTime: 10 * 60_000    // 10 min
```

Implicaciones:

- **`useArbol` jamás refetch automático**. Si un operador cambia algo en la BD, el frontend no se entera. Cerrar el tab y volver a abrir el PT NO refetchea (queryKey idéntica). Para forzar: `queryClient.invalidateQueries(["arbol", idPt, ...])` o agregar un botón de refresh (no implementado).
- **Cache de árbol crece sin tope durante la sesión** (~10-50 KB por árbol, ~20 PTs típicos → despreciable).
- **`useBloques`/`usePtsEnProceso` con TTL 2 min**: balance entre freshness y costo. Coincide con el TTL backend del router `bloques.py`.

## Layout cache (`lib/layoutCache.ts`)

```ts
const POR_KEY: Map<string, Map<string, {x:number; y:number}>> = new Map();

function keyFor(idPt: number, expanded: Set<number>): string {
  const lista = [...expanded].sort((a,b) => a-b).join(",");
  return `${idPt}|${lista}`;
}
```

**Por qué module-level y no en el componente**: cuando cambias de tab, `<ArbolCanvas key={idPt}>` se desmonta. Cualquier `useRef` o `useState` de posiciones se perdería. Module-level sobrevive porque vive en el closure del módulo, no en el árbol React.

**Por qué no en zustand**: el cache tiene Map de Map de objetos con números — no es serializable y no necesita disparar re-renders.

**Cuándo se invalida**:

- `dropCachedLayoutByPt(idPt)`: al cerrar un tab.
- `clearAllCachedLayouts()`: no se llama hoy, disponible para "limpiar todo".
- **Hot reload de Vite**: el módulo se re-evalúa, el Map se reinicia. Aceptable en dev.

**El cache NO se invalida con cambios de `mode` ni de `highlight`** porque la key no depende de ellos. Es lo correcto: tanto el toggle Inv/Req como el resaltado son re-render puros.

## Flujo de datos en `buildGraph`

```text
ArbolPT (response del backend)  +  expanded: Set<number>  +  highlight?: HighlightFiltro
    │
    ▼
[1] Identifica el PT raíz: arbol.pt.idMaterial
[2] Emite 1 nodo "pt" con data {clave, descripcion, piezasPend, wipTotal, ...}
    │
    ▼
[3] Para cada componente C en arbol.componentes (sin el PT):
    - Calcula ultimoPasoReal (último PasoRuta no virtual)
    - Calcula wipBuffer (PasoRuta virtual.wip_en_paso) y reqBufferFaltante
    - Calcula status (covered/partial/empty/neutral) con statusDeComponente()
    - Emite 1 nodo "component" con esa data + expandable + expanded + cantPadre
    │
    ▼
[4] Si expanded.has(C.idComp):
    - Filtra pasos NO virtuales
    - Emite N nodos "process" en cadena con:
        wipEnPaso (Por procesar), liberadas, enInspeccion
        + highlighted = (highlight && match idProceso + idPlanta? + tipo?)
    - Edges internos: paso_i → paso_{i+1} (smoothstep, dashed)
    - Último paso → card del componente
    │
    ▼
[5] Para cada arista hijo → padre del BOM:
    - sourceId = `c-${hijo.idComp}`
    - targetId = nodoEntrada(padre, idPt, expanded):
        si padre expandido y tiene pasos reales → procIdNode(padre, primer_paso.idProceso)
        si no                                    → cardIdNode(padre, idPt)
    - Edge smoothstep, sin label (las cantidades de ensamble ahora viven en el ComponentNode como ×N)
    │
    ▼
{ nodes, edges }
```

`nodoEntrada()` es la función clave para que los edges apunten al lugar correcto cuando el padre está expandido. Vive en `lib/buildGraph.ts`.

## Errores y estados

| Estado | UI |
| --- | --- |
| `isLoading: true` (árbol) | "Cargando arbol..." centrado en el canvas. |
| `error` truthy (árbol) | "Error al cargar el arbol del PT: {mensaje}" en rojo. |
| `data && componentes.length === 0` | Solo se ve la card del PT (sin hijos). |
| `view === "summary"` con bloques vacíos | "Sin WIP activo con los filtros actuales." |
| Backend devuelve 404 (sin demanda) | Axios lanza, TanStack lo expone como error. |
| `procesoFiltro` activo + `usePtsEnProceso` aún cargando | PtTable muestra "Cargando PTs del proceso..." |

No hay retry automático (`retry: 1` en `main.tsx`). Si quieres ofrecer "Reintentar", expón un botón que llame `query.refetch()`.

## Race conditions y casos sutiles

- **Cambio rápido de tab**: `<ArbolCanvas key={idPt}>` fuerza desmonte. La request en vuelo de TanStack se cancela vía AbortController (axios soporta `signal`). No se renderizan datos del PT anterior en el canvas nuevo.
- **Expansión durante carga**: si el usuario clickea expand antes que `data` llegue, `onNodeClick` no se dispara porque el nodo no existe aún. No hay race.
- **fitView en el primer mount**: `setTimeout 50ms` da tiempo a React Flow a registrar las posiciones. Si quitas el timeout, fitView se ejecuta antes que React Flow tenga los nodos y no centra.
- **Auto-expand vs colapso manual**: `autoExpandedKeyRef` evita reaplicar auto-expand cuando el usuario ya colapsó manualmente — pero solo dentro de la misma combinación PT × proceso × planta × tipos. Si cambia cualquiera de esos, vuelve a expandir.
- **`ClaseMultiSelect` se desmonta si no hay clases**: cuando ningún PT del listado tiene `idClase`, el componente devuelve `null` para no mostrar un select vacío. Si el universo cambia (ej. `usePts` con otra `fechaMax` trae items con clase), reaparece automáticamente.
