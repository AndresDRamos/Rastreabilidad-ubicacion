# frontend/docs/data-flow.md

> Cuándo cargar: cuando vayas a tocar `ArbolCanvas.tsx`, `buildGraph.ts`, `layoutCache.ts`, o cuando un cambio de UI no se vea reflejado y necesites trazar de dónde sale cada valor.

## Click de un PT en la sidebar → árbol renderizado

```
[1] Usuario click en una fila del PtTable
        │
        ▼
[2] PtTable.tsx llama  useUiStore.togglePt(fila.idMaterial)
        │
        ▼
[3] store muta:
       selectedPtIds: [..., idPt]
       activeTabId:   idPt
        │
        ▼
[4] App.tsx re-renderiza:
       idPt = activeTabId  →  monta <Tabs/> + <ArbolCanvas idPt={idPt}/>
       <ArbolCanvas key={idPt}>  ← key fuerza nuevo monte por PT
        │
        ▼
[5] ArbolCanvasInner ejecuta:
       const { data, isLoading } = useArbol(idPt, ventana)
        │
        ▼
[6] TanStack Query:
       queryKey = ["arbol", idPt, ventana]
       ¿cached?  SÍ  → devuelve data inmediatamente (sin refetch, staleTime: Infinity)
                 NO  → fetch /api/pts/{idPt}/arbol?ventana={N}
        │
        ▼
[7] backend (sync) → ArbolPT JSON
        │
        ▼
[8] useMemo recalcula layoutResult:
       (a) const { nodes, edges } = buildGraph(data, expanded)
       (b) key = `${idPt}|${expanded_ordenado_por_id}`
       (c) cache hit?  SÍ → reusar posiciones del cache
                       NO → layoutLR(nodes, edges) con dagre → guardar en cache
        │
        ▼
[9] useEffect:
       setNodes(layoutResult.nodes)
       setEdges(layoutResult.edges)
       setTimeout 50ms → fitView({ padding: 0.2, duration: 300 })
        │
        ▼
[10] ReactFlow renderiza nodos custom (PtNode, ComponentNode, ProcessNode)
     cada nodo lee `mode` del store directamente
```

`<ArbolCanvas key={idPt}>` en App.tsx: la `key` cambia al cambiar de tab, lo cual fuerza desmonte/monte completo del canvas. **Pero el `layoutCache` es module-level**, así que las posiciones persisten — solo el componente React vuelve a montarse, no los datos.

## Caso especial 1: toggle de modo Inventario/Requerimiento

```
[1] click en <ModeToggle/>
       │
       ▼
[2] store.setMode("inventario")
       │
       ▼
[3] PtNode / ComponentNode / ProcessNode re-renderizan
   (cada uno suscrito a useUiStore(s => s.mode))
       │
       ▼
[4] Cada nodo recalcula su número grande
   (PtNode: piezasPend vs wipTotal,
    ComponentNode: reqBufferFaltante vs wipBuffer,
    ProcessNode: reqPaso vs wipEnPaso)
```

**NO se refetchea** (useArbol no se vuelve a llamar).
**NO se re-layoutea** (layoutResult solo depende de `data`, `idPt`, `expanded`; no de `mode`).
**El cambio es re-render puro** en los nodos. Costo O(nodos visibles).

Esto es posible porque el backend devuelve **ambos valores** en cada `PasoRuta`: `wip_en_paso` Y `req_paso`. El frontend elige cuál mostrar.

## Caso especial 2: toggle expand de un componente

```
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
[5] buildGraph(data, expanded) emite N nodos process nuevos
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

**El cache es por combinación `(idPt, expanded)`**, así que si colapsas y vuelves a expandir el mismo set, las posiciones son las mismas que la última vez (perfecto para "deshacer mentalmente").

Si solo expandes uno más, la key cambia y se relayoutea. No hay layout incremental (dagre no lo soporta limpiamente y los árboles del dominio son pequeños — ~10-50 nodos típicamente).

## Cache de sesión de TanStack Query

```ts
// frontend/src/api/queries.ts
useQuery({
  queryKey: ["arbol", idPt, ventana],
  queryFn: () => fetchArbol(idPt, ventana),
  staleTime: Infinity,    // ← jamás se considera "stale"
  gcTime: Infinity,       // ← jamás se evicta del cache
});
```

Implicaciones:

- **Nunca refetch automático**. Si un operador cambia algo en la BD, el frontend no se entera.
- **Cache crece sin límite durante la sesión**. Aceptable porque cada `ArbolPT` pesa ~10-50 KB y los usuarios típicamente abren < 20 PTs.
- **Refresh manual**: cerrar el tab y volver a abrir el PT NO refetchea (la queryKey es la misma). Para forzar refetch, hay que llamar `queryClient.invalidateQueries(["arbol", idPt])` desde la consola o agregar un botón de refresh (no implementado).

`usePts(ventana)` sí tiene `staleTime: 5 * 60 * 1000` (5 min), porque el listado cambia con cada embarque.

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

**El cache NO se invalida con cambios de `mode`** porque la key no depende de `mode`. Es lo correcto: el toggle es re-render puro.

## Flujo de datos en `buildGraph`

```
ArbolPT (response del backend)
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
    - Emite 1 nodo "component" con esa data + expandable + expanded flags
    │
    ▼
[4] Si expanded.has(C.idComp):
    - Filtra pasos NO virtuales
    - Emite N nodos "process" en cadena
    - Edges internos: paso_i → paso_{i+1} (smoothstep, dashed)
    - Último paso → card del componente
    │
    ▼
[5] Para cada arista hijo → padre del BOM:
    - sourceId = `c-${hijo.idComp}`
    - targetId = nodoEntrada(padre, idPt, expanded):
        si padre expandido y tiene pasos reales → procIdNode(padre, primer_paso.idProceso)
        si no                                    → cardIdNode(padre, idPt)
    - Edge smoothstep, label "×{cantidad_ensamble}" si != 1
    │
    ▼
{ nodes, edges }
```

`nodoEntrada()` es la función clave para que los edges apunten al lugar correcto cuando el padre está expandido. Vive en `lib/buildGraph.ts`.

## Errores y estados

| Estado | UI |
| --- | --- |
| `isLoading: true` | "Cargando arbol..." centrado en el canvas. |
| `error` truthy | "Error al cargar el arbol del PT: {mensaje}" en rojo. |
| `data && componentes.length === 0` | Solo se ve la card del PT (sin hijos). |
| `selectedPtIds.length === 0` | `<EmptyState />` ("Selecciona un PT"). |
| Backend devuelve 404 (sin demanda) | Axios lanza, TanStack lo expone como error. |

No hay retry automático (`retry: 1` en `main.tsx`). Si quieres ofrecer "Reintentar", expón un botón que llame `query.refetch()`.

## Race conditions y casos sutiles

- **Cambio rápido de tab**: `<ArbolCanvas key={idPt}>` fuerza desmonte. La request en vuelo de TanStack se cancela vía AbortController (axios soporta `signal`). No se renderizan datos del PT anterior en el canvas nuevo.
- **Expansión durante carga**: si el usuario clickea expand antes que `data` llegue, `onNodeClick` no se dispara porque el nodo no existe aún. No hay race.
- **fitView en el primer mount**: `setTimeout 50ms` da tiempo a React Flow a registrar las posiciones. Si quitas el timeout, fitView se ejecuta antes que React Flow tenga los nodos y no centra.
