# frontend/docs/conventions.md

> Cuándo cargar: cuando vayas a hacer un cambio en algo que parece "raro" (cache, proxy, types, react-flow) y quieras saber por qué está así antes de tocarlo.

## TanStack Query: cache de sesión para árboles

`frontend/src/api/queries.ts`:

```ts
function useArbol(idPt: number | null, ventana: number) {
  return useQuery({
    queryKey: ["arbol", idPt, ventana],
    queryFn: () => fetchArbol(idPt!, ventana),
    enabled: idPt !== null,
    staleTime: Infinity,    // ← nunca se considera stale
    gcTime: Infinity,       // ← nunca se evicta
  });
}
```

**Razón**: el árbol de un PT (1-3 s de query SQL pesada) se consulta varias veces en una sesión (cambias de tab, cierras y reabres). Como la BD no cambia drásticamente minuto a minuto, cachear hasta el cierre de la pestaña es win neto.

**Consecuencias**:
- **Nunca se refetchea automáticamente.** Si el operador modifica algo en EPS, el frontend no se entera.
- **Refresco manual**: el usuario tendría que cerrar el tab y reabrir el PT. Esto **no refetchea por sí solo** porque la queryKey sigue siendo `["arbol", idPt, ventana]`. Para forzar refetch hay que llamar `queryClient.invalidateQueries(["arbol", idPt])` desde consola, o agregar un botón de refresh (no implementado).
- **Cache crece sin tope durante la sesión.** En la práctica, cada ArbolPT pesa 10-50 KB; aceptable.

Si necesitas que la app refresque sola, no toques esto: agrega un botón explícito de "refrescar" que llame a `invalidateQueries`. Cambiar `staleTime` cambia el comportamiento de TODOS los árboles y rompe la expectativa de "instantáneo al volver al tab".

## Layout cache: module-level a propósito

`frontend/src/lib/layoutCache.ts`:

```ts
const POR_KEY: Map<string, Map<string, {x:number; y:number}>> = new Map();
```

**Razón**: cuando el usuario cambia de tab, `<ArbolCanvas key={idPt}>` se desmonta. Cualquier `useRef`/`useState` se perdería. Module-level vive en el módulo, no en el árbol React.

**Key**: `${idPt}|${expanded_sorted_by_id}` — incluye el set de IDs expandidos para que cada combinación tenga su layout. Sortear por id es importante para que `{1,2}` y `{2,1}` generen la misma key.

**Lo que SÍ invalida cache**:
- Cerrar un tab (`dropCachedLayoutByPt(idPt)`).
- Refresh de Vite en dev (el módulo se re-evalúa).

**Lo que NO invalida cache** (a propósito):
- Cambiar `mode` (Inventario/Requerimiento) — el toggle es re-render puro de cada nodo.
- Re-render del canvas sin cambio de PT ni `expanded`.

Si mueves el cache a zustand, todos los componentes que lean ese state re-renderizarán al actualizar el cache. No quieres eso. Déjalo en module-level.

## Tabs y `selectedPtIds`

`useUiStore.togglePt(idMaterial)`:

```ts
togglePt: (id) => set((s) => {
  if (s.selectedPtIds.includes(id)) {
    return {};  // ya estaba seleccionado, no-op (no toggle)
  }
  return {
    selectedPtIds: [...s.selectedPtIds, id],
    activeTabId: id,
  };
}),
```

**Decisión**: click en un PT que ya está en `selectedPtIds` NO cierra el tab — el toggle es solo "agregar". Para cerrar hay que usar la X del tab.

**Razón**: evitar el bug clásico de "el usuario hizo doble click sin querer y perdió el árbol". Si quieres "click-to-toggle bidireccional", cámbialo en `togglePt`.

`closeTab` mueve `activeTabId` automáticamente:
- Si cierras el tab activo, salta al siguiente o al último restante.
- Si cierras el último tab, `activeTabId = null` y aparece `<EmptyState/>`.

## Filtros: client-side puro

`frontend/src/components/Sidebar/PtTable.tsx`:

```ts
const filtradas = filas?.filter(f =>
  matches(f.Cliente, filters.cliente) &&
  matches(f.Ciudad, filters.ciudad) &&
  matches(f.PT, filters.pt)
);
```

**Razón**: el listado completo (2880 PTs) cabe perfectamente en memoria y filtrar es instantáneo en JS. Mandar los filtros al backend obligaría a refetch en cada keystroke.

**Trade-off**: si el listado crece a 50,000+, esto se vuelve lento. En ese caso, mover a query param o usar `useDeferredValue`.

## Proxy de Vite (`vite.config.ts`)

```ts
server: {
  port: 5173,
  proxy: {
    "/api": { target: "http://localhost:8000", changeOrigin: true },
    "/health": { target: "http://localhost:8000", changeOrigin: true },
  },
},
```

**Razón**: el frontend usa rutas relativas (`/api/pts`, `/health`) en `axios`. En dev, Vite las proxea al backend. En prod, **uvicorn sirve la SPA y la API en el mismo puerto**, así que las rutas relativas funcionan sin proxy.

**Esto significa**: el mismo código JS funciona en dev y en prod sin variable de entorno `VITE_API_URL`. No la agregues sin necesidad.

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

## Tailwind: paleta semántica

Definida en `tailwind.config.ts`. Reglas:

- **Usa los tokens semánticos** (`status-covered`, `ink-muted`, `surface-border`), no clases Tailwind crudas (`green-500`).
- **Si necesitas un color que no existe**, agrégalo al config con nombre semántico (`status-warning`, `surface-elevated`), no `yellow-400`.
- **Alpha modifiers**: `bg-status-pt/10` da 10% de opacidad sobre el color base. Útil para fondos de header sin tener que definir un token nuevo.

`fmtInt` (en `lib/format.ts`) formatea miles con coma latinoamericana usando `Intl.NumberFormat("es-MX")`. Usa esta función para mostrar números grandes; no concatenes con `.toLocaleString()` inline.

## React Flow: `proOptions` y attribution

```ts
<ReactFlow proOptions={{ hideAttribution: true }} ...>
```

**Por qué**: `@xyflow/react` muestra un badge "React Flow" en la esquina por defecto. La opción `hideAttribution: true` lo quita. Es legal en proyectos internos, pero verifica la licencia si vas a publicar.

## `key={idPt}` en `<ArbolCanvas>`

```tsx
<ArbolCanvas key={idPt} idPt={idPt} />
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
