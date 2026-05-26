# frontend/docs/conventions.md

> Cuándo cargar: cuando vayas a hacer un cambio en algo que parece "raro" (cache, proxy, types, react-flow, drill-down) y quieras saber por qué está así antes de tocarlo.

## TanStack Query: 5 hooks, 5 strategias de cache

`frontend/src/api/queries.ts` expone 5 hooks con `staleTime` ajustado al volátil de cada dato:

| Hook | Endpoint | queryKey | staleTime | Por qué |
| --- | --- | --- | --- | --- |
| `usePts(ventana, fechaMax)` | `GET /api/pts` | `["pts", ventana, fechaMaxParam ?? null]` | 5 min | Espeja el TTL del backend (`routers/pts.py`). El listado se mueve con embarques pero no segundo a segundo. |
| `useArbol(idPt, ventana, fechaMax)` | `GET /api/pts/{id}/arbol` | `["arbol", idPt, ventana, fechaMax ?? null]` | `Infinity` (+ `gcTime: Infinity`) | El árbol cuesta 1-3 s y se consulta varias veces por sesión. Cachear hasta cerrar la pestaña es win neto. |
| `useBloques(...)` | `GET /api/bloques` | `["bloques", cliente, planta, ciudadesKey, tiposKey, clasesKey]` | 2 min | Espeja TTL backend. El Resumen muestra movimientos de WIP que cambian durante el día. |
| `usePtsEnProceso(...)` | `GET /api/bloques/{id}/pts` | `["pts-en-proceso", idProceso, cliente, planta, ciudadesKey, tiposKey, clasesKey]` | 2 min | Mismo razonamiento que bloques. |
| `usePlantas()` | `GET /api/plantas` | `["plantas"]` | 10 min | Catálogo casi estático. |

Reglas para mantener consistencia con el backend:

1. **CSV en query params** para listas (`ciudades`, `tipos_material`, `clases`). Implementado con `idsCsv` que devuelve `undefined` si la lista es vacía → axios omite el param. Si los devuelves vacíos (`""`) ensucias logs y bypassás el "sin filtro" del SQL.
2. **`null` → omitir param**: `cliente`, `planta`, `idProceso` solo se mandan si `!= null`. El backend interpreta ausencia como "sin filtro".
3. **`queryKey` debe incluir TODO lo que cambia la respuesta**. Si agregas un filtro nuevo, sumalo a la key o vas a servir resultados stale del cache.
4. **Para listas, normaliza el orden en la key**: hoy usamos `idsCsv(arr) ?? ""` directo. Si en algún momento permitís reordenar manualmente, asegurate de `sort()` antes de joinear, o `[1,2]` y `[2,1]` van a generar entradas distintas.

### Cache de sesión del árbol (`staleTime: Infinity`)

**Consecuencias**:

- **Nunca refetch automático**. Si un operador modifica algo en EPS, el frontend no se entera. Cerrar y reabrir el tab del PT NO refetchea (queryKey idéntica).
- **Refresh manual**: agregar un botón que llame `queryClient.invalidateQueries({ queryKey: ["arbol", idPt] })` — hoy no existe.
- **Cache crece sin tope durante la sesión** (~10-50 KB por árbol; aceptable).

Si necesitas refrescar automático, **no toques `staleTime`** porque romperías la expectativa de "instantáneo al volver al tab". Agrega un botón explícito.

## `api/client.ts` — `baseURL = "/api"`

```ts
export const apiClient = axios.create({ baseURL: "/api", ... });
```

Las queries usan rutas como `/pts`, `/bloques/{id}/pts`, `/plantas` (sin el `/api`). El cliente lo prefija. En dev, Vite proxea `/api/*` a `localhost:8000`. En prod, uvicorn sirve SPA + API en el mismo puerto → mismas rutas relativas funcionan sin tocar nada.

**No agregues `VITE_API_URL`**: la app está pensada para vivir co-deployada con el backend. Si en algún momento se separan, mueve `baseURL` a env var y documenta.

## Layout cache: module-level a propósito

`frontend/src/lib/layoutCache.ts`:

```ts
const POR_KEY: Map<string, Map<string, {x:number; y:number}>> = new Map();
```

**Razón**: cuando el usuario cambia de tab, `<ArbolCanvas key={idPt}>` se desmonta. Cualquier `useRef`/`useState` se perdería. Module-level vive en el módulo, no en el árbol React.

**Key**: `${idPt}|${expanded_sorted_by_id}` — incluye el set de IDs expandidos. Sortear por id es importante para que `{1,2}` y `{2,1}` generen la misma key.

**Lo que SÍ invalida cache**:

- Cerrar un tab (`dropCachedLayoutByPt(idPt)`).
- Refresh de Vite en dev (el módulo se re-evalúa).

**Lo que NO invalida cache** (a propósito):

- Cambiar `mode` (Inventario/Requerimiento) — el toggle es re-render puro de cada nodo.
- Cambiar `procesoFiltro` / `HighlightFiltro` — solo afecta cuál `ProcessNode` se resalta visualmente, no la topología.
- Re-render del canvas sin cambio de PT ni `expanded`.

Si mueves el cache a zustand, todos los componentes que lean ese state re-renderizarán al actualizar el cache. No quieres eso. Déjalo en module-level.

## Tabs y `selectedPtIds`

`useUiStore.togglePt(idMaterial)`:

```ts
togglePt: (id) => set((s) => {
  if (s.selectedPtIds.includes(id)) {
    // YA seleccionado → cerrar tab
    const next = s.selectedPtIds.filter((x) => x !== id);
    const nextActive = s.activeTabId === id ? next[next.length - 1] ?? null : s.activeTabId;
    return { selectedPtIds: next, activeTabId: nextActive,
             view: nextActive === null ? "summary" : "tree" };
  }
  return { selectedPtIds: [...s.selectedPtIds, id], activeTabId: id, view: "tree" };
}),
```

**Decisión actual**: click en un PT que ya está en `selectedPtIds` **CIERRA el tab** (toggle bidireccional). Antes era solo "agregar"; se cambió porque el row de la tabla tiene un checkbox visible y los usuarios esperan que toggle ambos sentidos.

`closeTab` (la X de la tab) hace lo mismo + invalida el layoutCache del PT cerrado.

Si cerrás el último tab activo, `activeTabId = null` y `view = "summary"` → vuelves al Resumen.

## Filtros: dónde se aplica cada uno

| Filtro | Sidebar (client-side) | `/api/pts` (server) | `/api/bloques*` (server) | Highlight árbol |
| --- | --- | --- | --- | --- |
| `clienteId` | Sí (filtra rows) | No | Sí (`cliente=…`) | No |
| `ciudadIds` | Sí (filtra rows) | No | Sí (`ciudades=…`) | No |
| `pt` (texto) | Sí (`includes` sobre `f.PT`) | No | No | No |
| `fechaMax` | No (se manda al backend) | Sí (`fecha_max=…`) | No | No |
| `plantaId` | No | No | Sí (`planta=…`) | Sí (en `HighlightFiltro.idPlanta`) |
| `tipoMaterialIds` | No | No | Sí (`tipos_material=…`) | Sí (en `HighlightFiltro.idsTipoMaterial`) |
| `claseIds` | No | No | Sí (`clases=…`) | No |

**Razones**:

- **Listado**: el dataset completo cabe en memoria (~2880 PTs). Filtrar en JS es instantáneo y evita refetch por keystroke. El único filtro que SÍ va al backend es `fechaMax` porque acota la query SQL en origen.
- **Resumen**: agrega WIP en SQL Server, no podemos filtrar client-side sin haber traído todo. Cada filtro viaja al endpoint y el cache key del frontend los incluye.
- **Highlight del árbol**: `plantaId` y `tipoMaterialIds` matchean a nivel `PasoRuta`/`NodoComponente`, no a nivel de árbol completo — se aplican en `buildGraph` y como decisión de auto-expand.

Si el listado crece a 50,000+ filas, lo más sano es mover el filtrado completo al backend (un endpoint `GET /api/pts/search?...` paginado).

## Cast `as unknown as Node[]` en ArbolCanvas

```ts
const nodes = rawNodes as unknown as Node[];
```

**Razón técnica**: `ArbolNode` es la unión `Node<PtNodeData> | Node<ComponentNodeData> | Node<ProcessNodeData>`. React Flow 12 (con `useNodesState<Node>([])`) trabaja con `Node` genérico, no con uniones de data tipada. El cast existe para hacerlos convivir.

**Es seguro porque**:

- Los nodos custom (`PtNode`, etc.) reciben su `data` tipada vía `NodeProps<Node<X>>` — TypeScript valida ahí.
- React Flow no inspecciona `data` en runtime; solo la pasa al componente.

**No lo "limpies"** con un cast más restrictivo: vas a chocar con el genérico de `useNodesState`. Es una limitación conocida de React Flow 12 con uniones.

## Tipos espejo de pydantic

`frontend/src/api/types.ts` refleja 1:1 los modelos de `backend/src/rbom_api/domain/modelo.py`. No hay generador automático.

**Si cambias un campo en el backend**:

1. Replicarlo en `api/types.ts`.
2. Asegurar que los componentes que usan ese tipo siguen compilando con `npm run typecheck`.

**Si tienes muchos cambios pendientes**, considera generar tipos desde `openapi.json` (FastAPI lo expone automáticamente en `/openapi.json`) con `openapi-typescript`. No está integrado hoy, pero el setup es 1 archivo.

## Drill-down y `HighlightFiltro`

Diseño actual:

1. La sidebar siempre lista PTs con demanda activa. Si hay `procesoFiltro`, se intersecta con `/api/bloques/{idProceso}/pts` y se prioriza por `piezasEnProceso DESC`.
2. Al abrir un PT con `procesoFiltro` activo, el `ArbolCanvas` arma un `HighlightFiltro = { idProceso, idPlanta, idsTipoMaterial }` y lo pasa a `buildGraph`.
3. `buildGraph` marca `highlighted=true` en cada `ProcessNode` que matchee. El `ArbolCanvas` además dispara un `useEffect` que auto-expande los componentes que tienen un paso matcheador — pero solo la **primera vez** por combinación (PT × proceso × planta × tipos), tracked en `autoExpandedKeyRef`.

**Por qué el ref de auto-expand**: si el usuario colapsa manualmente, no querés re-expandir al cambiar de tab y volver. El ref retiene la última combinación auto-aplicada; mientras no cambie `procesoFiltro` o sus subdims, no re-expandés.

**Si querés agregar otra dim de highlight** (ej. status del componente, o un set de keys arbitrarias), extiende `HighlightFiltro`, el cálculo de `isHighlighted` en `buildGraph` y la key de `autoExpandedKeyRef`.

## Tailwind: paleta semántica

Definida en `tailwind.config.ts`. Reglas:

- **Usa los tokens semánticos** (`status-covered`, `ink-muted`, `surface-border`), no clases Tailwind crudas (`green-500`).
- **Si necesitas un color que no existe**, agrégalo al config con nombre semántico (`status-warning`, `surface-elevated`), no `yellow-400`.
- **Alpha modifiers**: `bg-status-pt/10` da 10% de opacidad sobre el color base. Útil para fondos de header sin tener que definir un token nuevo.

`fmtInt` (en `lib/format.ts`) formatea miles con coma latinoamericana usando `Intl.NumberFormat("es-MX")`. Usa esta función para mostrar números grandes; no concatenes con `.toLocaleString()` inline.

`fmtPlanta` mapea ids de planta a etiquetas legibles: `5 → "Externo"`, otros → `"Planta N"`. Si el catálogo crece, considera cargar desde `/api/plantas` y mapear in-store.

## React Flow: `proOptions` y attribution

```ts
<ReactFlow proOptions={{ hideAttribution: true }} ...>
```

`@xyflow/react` muestra un badge "React Flow" en la esquina por defecto. La opción `hideAttribution: true` lo quita. Es legal en proyectos internos, pero verifica la licencia si vas a publicar.

## `key={idPt}` en `<ArbolCanvas>`

```tsx
<ArbolCanvas key={activeTabId} idPt={activeTabId} />
```

**Razón**: al cambiar `activeTabId`, queremos que el componente se DESMONTE y MONTE de nuevo, no que actualice props internamente. Esto:

- Limpia el state de `useNodesState`/`useEdgesState` (evita "phantom nodes" del tab anterior).
- Garantiza que `useEffect` se ejecuta de nuevo.
- Permite que el `layoutCache` module-level reasigne posiciones sin pelear con state local.

**Si quitas la key**, los nodos del PT anterior pueden quedarse pintados un frame mientras llegan los nuevos. Mantén la key.

## QueryClient config (`main.tsx`)

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
```

- `refetchOnWindowFocus: false` — no refetch al hacer focus en la ventana. Sería molesto en una herramienta interna donde la gente cambia de pestaña constantemente.
- `retry: 1` — un solo reintento ante error. Más reintentos esconden problemas reales de red.

No cambies estos defaults sin razón fuerte.
