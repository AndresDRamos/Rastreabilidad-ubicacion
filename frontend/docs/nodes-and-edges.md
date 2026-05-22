# frontend/docs/nodes-and-edges.md

> Cuándo cargar: cuando vayas a tocar la apariencia o semántica de los nodos del canvas (cards, colores, qué número mostrar) y/o cómo se conectan las edges.

## Tres tipos de nodos

| Tipo | Componente | Tamaño | Cuándo se renderiza |
| --- | --- | --- | --- |
| `pt` | `PtNode` | 240px ancho | Siempre que haya árbol cargado (1 por árbol). |
| `component` | `ComponentNode` | 240px ancho | 1 por cada componente intermedio (`idComp != idPt`). |
| `process` | `ProcessNode` | 180px ancho | 1 por cada `PasoRuta` no virtual, **solo si** el componente está en `expanded`. |

Los pasos `es_virtual=true` (buffer `Almacen WIP` al final de los intermedios) **nunca** se renderizan como nodos. Sus valores se reflejan en la card del componente.

## Qué muestra cada nodo según `mode`

### `PtNode` (`frontend/src/components/Canvas/nodes/PtNode.tsx`)

| Campo | mode = "inventario" | mode = "requerimiento" |
| --- | --- | --- |
| Número grande | `wipTotal` ("en piso") | `piezasPend` ("pendientes") |
| Header | "PRODUCTO TERMINADO" + `▶ procesos` / `▼ procesos` si expandable + `{piezasPastDue} past-due` si > 0 |
| Body | `clave`, `descripcion` (truncada), cliente · ciudad |
| Borde | `border-2 border-status-pt` (azul) siempre |

### `ComponentNode` (`frontend/src/components/Canvas/nodes/ComponentNode.tsx`)

| Campo | mode = "inventario" | mode = "requerimiento" |
| --- | --- | --- |
| Número grande | `wipBuffer` ("en buffer") | `reqBufferFaltante` ("por fabricar") |
| Header | "Nivel {N}" + `▶ procesos` / `▼ procesos` + badge de status (Cubierto/Parcial/Sin WIP/Sin demanda) |
| Body | `clave`, `descripcion` (truncada), `cadenaRuta` (texto pequeño) |
| Borde | color según `status` (ver tabla abajo) |

Donde:
- `wipBuffer = ultimoPasoVirtual.wip_en_paso` (las piezas en el `Almacen WIP` del componente, listas para consumo por el padre).
- `reqBufferFaltante = max(0, reqBruto - wipBuffer)` (cuántas piezas todavía debo fabricar y poner en el buffer).

### `ProcessNode` (`frontend/src/components/Canvas/nodes/ProcessNode.tsx`)

| Campo | mode = "inventario" | mode = "requerimiento" |
| --- | --- | --- |
| Número grande | `wipEnPaso` ("en este paso") | `reqPaso` ("por procesar") |
| Header | "Paso {N}/{total}" |
| Body | nombre del proceso, sub-ruta (si distinta al proceso) |
| Borde | `border-status-covered/40` si `reqPaso ≤ 0` (cubierto); `border-status-partial/50` si hay WIP en este paso; `border-surface-border` si no. |

## Status (colores semánticos)

Definidos en `frontend/tailwind.config.ts`:

| Status | Color | Cuándo aplica (calculado en `lib/buildGraph.ts::statusDeComponente`) |
| --- | --- | --- |
| `pt` | Azul (`#3b82f6`) | Siempre para el PT raíz. |
| `covered` | Verde (`#10b981`) | `req_paso del último paso real <= 0` (componente cubierto). |
| `partial` | Naranja (`#f59e0b`) | `wip_total > 0` pero no cubierto (parcial). |
| `empty` | Rojo (`#ef4444`) | `wip_total <= 0` y `req_bruto > 0` (sin WIP, pendiente). |
| `neutral` | Gris (`#94a3b8`) | `req_bruto <= 0` (sin demanda en este componente — raro). |

```ts
function statusDeComponente(c: NodoComponente, ultimoPasoReal: PasoRuta | null): Status {
  if (c.req_bruto <= 0) return "neutral";
  const reqUlt = ultimoPasoReal?.req_paso ?? c.req_bruto;
  if (reqUlt <= 0) return "covered";
  if (c.wip_total <= 0) return "empty";
  return "partial";
}
```

**Importante**: el `ultimoPasoReal` es el último paso **no virtual**. Es decir, para un componente con ruta `Corte → Doblez → [virtual]`, el último paso real es Doblez. La lógica usa Doblez, no el buffer virtual.

## Mapeo en el MiniMap

```ts
nodeColor={(n) => {
  switch (n.data.status) {
    case "pt":      return "#3b82f6";
    case "covered": return "#10b981";
    case "partial": return "#f59e0b";
    case "empty":   return "#ef4444";
    default:        return "#94a3b8";
  }
}}
```

Los nodos `process` no tienen `status` en su data → caen al default gris en el minimapa.

## Edges

### Por defecto (hijo → padre directo)

```
ComponentNode(hijo)  ──────────────►  PtNode(padre)
                                       (o ComponentNode si es nieto)
```

`smoothstep`, stroke `#cbd5e1` 1.5px. Label `×{cant}` si `cantidad_ensamble != 1`.

### Si el padre está expandido

```
ComponentNode(hijo)  ──────────────►  ProcessNode(primer paso real del padre)
```

`nodoEntrada(padre, idPt, expanded)` decide el target:
- Padre expandido y tiene pasos reales → `procIdNode(padre.idComp, primer_paso_real.idProceso)`.
- Padre no expandido, o sin pasos reales → `cardIdNode(padre.idComp, idPt)` (la card).

### Edges internos (entre pasos del mismo componente)

```
ProcessNode(paso_i)  ─ – ─ – ─ – ►  ProcessNode(paso_i+1)
                                    o ComponentNode (si paso_i era el último)
```

`smoothstep`, stroke punteado (`strokeDasharray: "4 3"`) para diferenciarlos de las edges hijo→padre.

### Componentes shared (multi-padre)

Un componente que aparece bajo dos padres tiene **una sola card** en el árbol pero **dos edges** salientes (una a cada padre). El `cantidad_ensamble` puede diferir por aparición.

## IDs de nodo (convención)

```
PT card:        "pt-{idPt}"             (idPt = idMaterial del PT raíz)
Component card: "c-{idComp}"
Process node:   "p-{idComp}-{idProceso}"
Edge:           "e-{source}-to-{target}"   (default)
                "ei-{source}-to-{target}"  (interna entre pasos)
```

Helpers: `cardIdNode(idComp, idPt)`, `procIdNode(idComp, idProceso)` en `lib/buildGraph.ts`. Úsalos siempre, no construyas IDs a mano.

## Indicador visual de expandible

En el header de PtNode y ComponentNode:

```
▶ procesos    (cuando expandable && !expanded)
▼ procesos    (cuando expandable && expanded)
(nada)        (cuando !expandable)
```

`expandable = true` si el componente tiene al menos un `PasoRuta` no virtual. Cards con `expandable=true` reciben `cursor-pointer` adicional.

## Handles

Cada nodo tiene **un solo handle** por lado:

```ts
<Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-... !border-0" />
<Handle type="target" position={Position.Left}  className="!w-2 !h-2 !bg-... !border-0" />
```

`source` a la derecha, `target` a la izquierda. Esto encaja con el layout LR de dagre. No soportamos edges multi-handle (sería rebuscado para BOM).

## Decisiones visuales no obvias

- **Card del PT siempre azul**, aunque internamente su status sea covered/partial. La razón: el azul "soy un PT" es categórico, no de estado. Los matices de status se ven en la card pero por el badge interno (futuro), no por el borde.
- **`bg-status-pt/10` en el header del PT**: tono claro del azul. El `/10` es alpha 10% sobre el color base.
- **MiniMap muestra solo cards** (no procesos) — los procesos quedan grises porque no tienen status. Es OK; el minimapa es para orientación general, no para detalle.
- **Edges internos punteados** porque visualmente "dentro de un componente" no es el mismo nivel que "entre componentes". El stroke continuo se reserva para relaciones de BOM.
- **`label` del PasoRuta** (`"Doblez (4 de 218)"`) lo construye el backend (`netteo._construir_pasos`). El frontend solo lo muestra cuando hace falta (no en la card por defecto; sí en `cadenaRuta` truncada).

## Cómo agregar un cuarto tipo de nodo

Pasos mínimos si quisieras agregar (hipotéticamente) un nodo "advertencia":

1. Crear `frontend/src/components/Canvas/nodes/WarningNode.tsx` con `NodeProps<Node<WarningNodeData>>`.
2. Definir `WarningNodeData extends Record<string, unknown>` en `lib/buildGraph.ts` y agregarlo al tipo unión `ArbolNode`.
3. En `buildGraph()`, emitir el nodo cuando aplique.
4. Registrarlo en `NODE_TYPES` de `ArbolCanvas.tsx`: `{ pt: PtNode, component: ComponentNode, process: ProcessNode, warning: WarningNode }`.
5. Si necesita interacción con click, agregar al `onNodeClick` de `ArbolCanvas`.
6. Añadirlo al `MiniMap.nodeColor` si quieres que se vea bien en el minimapa.
