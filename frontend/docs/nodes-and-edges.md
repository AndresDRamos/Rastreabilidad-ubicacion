# frontend/docs/nodes-and-edges.md

> Cuándo cargar: cuando vayas a tocar la apariencia o semántica de los nodos del canvas (cards, colores, qué número mostrar) y/o cómo se conectan las edges.

## Tres tipos de nodos

| Tipo | Componente | Tamaño | Cuándo se renderiza |
| --- | --- | --- | --- |
| `pt` | `PtNode` | 240px ancho | Siempre que haya árbol cargado (1 por árbol). |
| `component` | `ComponentNode` | 240px ancho | 1 por cada componente intermedio (`idComp != idPt`). |
| `process` | `ProcessNode` | 220px ancho | 1 por cada `PasoRuta` no virtual, **solo si** el componente está en `expanded`. |

Los pasos `es_virtual=true` (buffer `Almacen WIP` al final de los intermedios) **nunca** se renderizan como nodos. Sus valores se reflejan en la card del componente.

## Qué muestra cada nodo según `mode`

### `PtNode` (`frontend/src/components/Canvas/nodes/PtNode.tsx`)

Lo que depende del modo:

| Campo | mode = "inventario" | mode = "requerimiento" |
| --- | --- | --- |
| Número grande | `wipTotal` ("en piso") | `piezasPend` ("pendientes") |

Lo que es independiente del modo:

- **Header**: etiqueta "PRODUCTO TERMINADO" + chip "procesos" con icono de árbol si `expandable` (filled cuando `expanded`, outlined si no).
- **Body**: `PartThumbnail` + `clave`, `descripcion` (truncada), cliente · ciudad.
- **Borde**: `border-2 border-status-pt` (azul) siempre.

### `ComponentNode` (`frontend/src/components/Canvas/nodes/ComponentNode.tsx`)

Lo que depende del modo:

| Campo | mode = "inventario" | mode = "requerimiento" |
| --- | --- | --- |
| Número grande | `wipBuffer` ("en buffer") | `reqBufferFaltante` ("por fabricar") |

Lo que es independiente del modo:

- **Header**: "Nivel {N}" + chip "procesos" si `expandable` (color según `status`) + badge de status (Cubierto/Parcial/Sin WIP/Sin demanda).
- **Body**: `PartThumbnail` + `clave`, `descripcion`. Indicador `×{cantPadre}` abajo a la derecha si `cantPadre > 1`.
- **Borde**: color según `status` (ver tabla abajo).

Donde:

- `wipBuffer = ultimoPasoVirtual.wip_en_paso` (las piezas en el `Almacen WIP` del componente, listas para consumo por el padre).
- `reqBufferFaltante = max(0, reqBruto - wipBuffer)` (cuántas piezas todavía debo fabricar y poner en el buffer).
- `cantPadre = cantidad_ensamble_total` del componente (suma sobre todas las aristas padre). Antes vivía como label en el edge; se movió a la card para reducir ruido visual cuando el árbol crece.

### `ProcessNode` (`frontend/src/components/Canvas/nodes/ProcessNode.tsx`)

**Independiente del toggle Inv/Req**: muestra siempre las 3 métricas WIP simultáneamente.

| Campo | Valor |
| --- | --- |
| Header | "Paso {N}/{total}" + `fmtPlanta(idPlanta)` si aplica ("Planta 4", "Externo", etc.) |
| Cuerpo (línea) | `proceso` + sub-ruta (`ruta` si distinta al proceso) |
| Métrica 1 | `wipEnPaso` ("Por procesar") — verde si > 0, gris si 0 |
| Métrica 2 | `liberadas` ("Liberadas") — azul si > 0 |
| Métrica 3 | `enInspeccion` ("En Inspección") — naranja si > 0 |
| Borde | `border-status-pt` si `highlighted=true`; `border-status-covered/40` si `reqPaso ≤ 0`; `border-status-partial/50` si hay WIP en este paso; `border-surface-border` si no. |
| Ring + bg header | `ring-status-pt/40` + `bg-status-pt/10` cuando `highlighted=true` (drill-down activo) |

`req_paso` se sigue calculando en el backend y viaja en el response, pero hoy solo lo usamos para decidir el borde "cubierto" del ProcessNode y para `cadenaRuta` (label compacta en el ComponentNode). Si quieres mostrarlo numéricamente, hidrata `ProcessNodeData.reqPaso` (ya está mapeado) y agrega una métrica más.

## Status (colores semánticos)

Definidos en `frontend/tailwind.config.ts`:

| Status | Color | Cuándo aplica (calculado en `lib/buildGraph.ts::statusDeComponente`) |
| --- | --- | --- |
| `pt` | Azul (`#3b82f6`) | Siempre para el PT raíz. |
| `covered` | Verde (`#10b981`) | `req_paso del último paso real <= 0` (componente cubierto). |
| `partial` | Naranja (`#f59e0b`) | `wip_total > 0` pero no cubierto (parcial). |
| `empty` | Rojo (`#ef4444`) | `wip_total <= 0` y `req_bruto > 0` (sin WIP, pendiente). |
| `neutral` | Gris (`#64748b`) | `req_bruto <= 0` (sin demanda en este componente — raro). |

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

## Highlight (drill-down activo)

`buildGraph` acepta un tercer parámetro opcional:

```ts
export interface HighlightFiltro {
  idProceso: number;
  idPlanta: number | null;
  /** Si vacío o ausente, no filtra por tipo. 1=PT, 3=Intermedio. */
  idsTipoMaterial?: number[];
}
```

Cuando se pasa, cada `ProcessNode` evalúa:

```ts
const matchTipo =
  tiposFiltro.length === 0 || tiposFiltro.includes(c.tipo_material);
const isHighlighted =
  highlight !== null &&
  paso.idProceso === highlight.idProceso &&
  (highlight.idPlanta === null || paso.idPlanta === highlight.idPlanta) &&
  matchTipo;
```

El `ArbolCanvas` además dispara una auto-expansión inicial de los componentes que matchean (ver `data-flow.md` sección drill-down).

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

```text
ComponentNode(hijo)  ──────────────►  PtNode(padre)
                                       (o ComponentNode si es nieto)
```

`smoothstep`, stroke `#cbd5e1` 1.5px. **Sin label** — la cantidad de ensamble se muestra como `×N` en el `ComponentNode` cuando es > 1.

### Si el padre está expandido

```text
ComponentNode(hijo)  ──────────────►  ProcessNode(primer paso real del padre)
```

`nodoEntrada(padre, idPt, expanded)` decide el target:

- Padre expandido y tiene pasos reales → `procIdNode(padre.idComp, primer_paso_real.idProceso)`.
- Padre no expandido, o sin pasos reales → `cardIdNode(padre.idComp, idPt)` (la card).

### Edges internos (entre pasos del mismo componente)

```text
ProcessNode(paso_i)  ─ – ─ – ─ – ►  ProcessNode(paso_i+1)
                                    o ComponentNode (si paso_i era el último)
```

`smoothstep`, stroke punteado (`strokeDasharray: "4 3"`) para diferenciarlos de las edges hijo→padre.

### Componentes shared (multi-padre)

Un componente que aparece bajo dos padres tiene **una sola card** en el árbol pero **dos edges** salientes (una a cada padre). El `cantidad_ensamble` puede diferir por aparición — la card muestra la suma (`cantPadre`).

## IDs de nodo (convención)

```text
PT card:        "pt-{idPt}"             (idPt = idMaterial del PT raíz)
Component card: "c-{idComp}"
Process node:   "p-{idComp}-{idProceso}"
Edge default:   "e-{source}-to-{target}"
Edge interna:   "ei-{source}-to-{target}"   (entre pasos del mismo componente)
```

Helpers: `cardIdNode(idComp, idPt)`, `procIdNode(idComp, idProceso)` en `lib/buildGraph.ts`. Úsalos siempre, no construyas IDs a mano.

## Chip "procesos" (indicador visual de expandible)

En el header de PtNode y ComponentNode:

```text
chip outlined  (color del status)   cuando expandable && !expanded
chip filled    (color del status)   cuando expandable &&  expanded
(nada)                              cuando !expandable
```

Es un pill con icono SVG de árbol (línea vertical + 2 ramas + nodos) + el texto "procesos". Color heredado del status del componente (en el PT siempre azul). Reemplaza el viejo "▶ procesos / ▼ procesos" textual.

`expandable = true` si el componente tiene al menos un `PasoRuta` no virtual. Cards con `expandable=true` reciben `cursor-pointer`.

## Handles

Cada nodo tiene **un solo handle** por lado:

```ts
<Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-... !border-0" />
<Handle type="target" position={Position.Left}  className="!w-2 !h-2 !bg-... !border-0" />
```

`source` a la derecha, `target` a la izquierda. Esto encaja con el layout LR de dagre. No soportamos edges multi-handle (sería rebuscado para BOM).

## `PartThumbnail` (común a PtNode y ComponentNode)

Lazy-load de imagen desde `http://192.168.4.5/Dibujos/normal/{clave}.jpg`. Si la imagen falla (404 o red), queda el placeholder SVG. Es un componente `React.memo`, así que cambiar `mode` no lo re-renderiza.

**Si despliegas la app a un origen que no puede alcanzar `192.168.4.5`**, las miniaturas quedan en placeholder — no rompe nada. Si quieres host configurable, mover a env var (`VITE_THUMBNAIL_BASE_URL`) y leer desde `import.meta.env`.

## Decisiones visuales no obvias

- **Card del PT siempre azul**, aunque internamente su status sea covered/partial. La razón: el azul "soy un PT" es categórico, no de estado.
- **`bg-status-pt/10` en headers azules**: tono claro del azul. El `/10` es alpha 10% sobre el color base.
- **MiniMap muestra solo cards** (no procesos) — los procesos quedan grises porque no tienen status. Es OK; el minimapa es para orientación general, no para detalle.
- **Edges internos punteados** porque visualmente "dentro de un componente" no es el mismo nivel que "entre componentes". El stroke continuo se reserva para relaciones de BOM.
- **`label` del PasoRuta** (`"Doblez (4 de 218)"`) lo construye el backend (`netteo._construir_pasos`). El frontend ya no lo muestra textualmente en los nodos process (las 3 métricas reemplazaron esa info); sí aparece en `cadenaRuta` truncada del ComponentNode.
- **`cantPadre` en el ComponentNode**: antes vivía como label sobre el edge. Lo movimos a la card porque (a) con árboles densos los labels se solapaban y (b) en componentes shared, la lectura "este pieza necesita ×N para cada padre" es más clara en la card que en la flecha.
- **3 métricas siempre visibles en ProcessNode**: trade-off contra ocultarlas detrás del toggle. El usuario operacional quiere ver "Por procesar" para planear y "Liberadas/Inspección" para entender por qué los números del netteo cambian — mostrarlas juntas evita un toggle más.

## Cómo agregar un cuarto tipo de nodo

Pasos mínimos si quisieras agregar (hipotéticamente) un nodo "advertencia":

1. Crear `frontend/src/components/Canvas/nodes/WarningNode.tsx` con `NodeProps<Node<WarningNodeData>>`.
2. Definir `WarningNodeData extends Record<string, unknown>` en `lib/buildGraph.ts` y agregarlo al tipo unión `ArbolNode`.
3. En `buildGraph()`, emitir el nodo cuando aplique.
4. Registrarlo en `NODE_TYPES` de `ArbolCanvas.tsx`: `{ pt: PtNode, component: ComponentNode, process: ProcessNode, warning: WarningNode }`.
5. Si necesita interacción con click, agregar al `onNodeClick` de `ArbolCanvas`.
6. Añadirlo al `MiniMap.nodeColor` si quieres que se vea bien en el minimapa.
