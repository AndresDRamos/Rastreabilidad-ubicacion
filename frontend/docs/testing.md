# frontend/docs/testing.md

> Cuándo cargar: cuando vayas a validar un cambio en el frontend, debuggear algo en el navegador, o agregar el primer test suite automatizado (no existe hoy).

## Estado actual

**No hay test suite frontend.** El gate de calidad estable es:

```powershell
cd frontend
npm run typecheck    # tsc --noEmit, debe pasar sin errores
npm run build        # vite build, debe terminar OK
```

`typecheck` y `build` deben pasar ANTES de marcar cualquier cambio como hecho. Si `build` mostrara errores y `typecheck` pasara, hay algo raro (probablemente CSS o config).

## Validación visual (manual)

Hay **dos flujos** que validar después de cualquier cambio que toque vistas / store / queries:

### Flujo A — Vista Resumen (default al cargar)

1. `.\scripts\dev-up.ps1` y abrir `http://127.0.0.1:5173`.
2. Verificar que la tab "Resumen" arranca activa, que hay tarjetas de bloques visibles y que los totales del header coinciden con la suma de las tarjetas.
3. Cambiar `Planta` → las tarjetas se recargan filtradas. Si la planta no tiene WIP, ver "Sin WIP activo con los filtros actuales.".
4. Toggle `Tipo` (PT / Intermedio) → las tarjetas reflejan el filtro.
5. Setear un cliente desde la sidebar (`ClienteCombobox`) → aparece chip "Cliente fijado" en el header del Resumen; las tarjetas se filtran.
6. Click en una tarjeta (ej. "Doblez") → el bloque queda marcado "filtrado" y la sidebar (`PtTable`) se intersecta a los PTs que tienen componentes esperando Doblez, con badge "N en Doblez".

### Flujo B — Drill-down al árbol

El "smoke test" oficial es navegar al **PT canónico 91711066-RA** (`Hood W, Rear Engine`, CNH Industrial America LLC) y verificar los números esperados (mode por defecto = `inventario`):

| Elemento | Modo Inventario | Modo Requerimiento |
| --- | --- | --- |
| Card PT `91711066-RA` | `0 en piso` | `222 pendientes` |
| Card componente `90358715-RA` (Angle, Strut) | `0 en buffer`, status `Parcial` (naranja) | `222 por fabricar` |
| Card componente `91711040-RA` (Hood, Engine Rear) | `9 en buffer`, status `Parcial` | `213 por fabricar` |

Al expandir el componente `90358715-RA`:

- 2 nodos process en cadena: `Corte laser` → `Doblez`.
- En modo agnóstico (el `ProcessNode` siempre muestra 3 métricas): `Doblez` debe tener `Por procesar = 4`.

Al expandir `91711040-RA`:

- 3 nodos process en cadena: `Corte (Punzonadora)` → `Nivelado` → `Doblez`.

Estos son los mismos números que validan los tests `test_req_paso_caso_diagrama_usuario` (unit) y `test_arbol_pt_canonico_cuadra_con_diagrama` (e2e). Si no cuadran, **el algoritmo de netteo está roto** — no es un bug visual.

### Flujo C — Cruce Resumen ↔ árbol (drill-down)

1. En Resumen, click en bloque "Doblez" (idProceso=4).
2. La sidebar prioriza PTs con WIP esperando Doblez; `91711066-RA` debe aparecer en los primeros con su badge "4 en Doblez" (o el número que corresponda al snapshot).
3. Click en `91711066-RA` → se abre el tab con el árbol.
4. **Auto-expand**: los componentes con paso `idProceso=4` deben expandirse solos.
5. **Highlight**: los `ProcessNode` de Doblez deben tener ring azul y bg-status-pt/10 en su header.
6. Colapsar manualmente uno de esos componentes → cambiar de tab "Resumen" → volver al PT → el componente colapsado **NO debe re-expandirse** (lo evita `autoExpandedKeyRef`).
7. Click nuevamente en otro bloque del Resumen (ej. "Nivelado") → al volver al árbol, los Nivelado deben highlighted; los Doblez ya no.

## Procedimiento de validación visual rápido

```powershell
# 1. Levantar ambos
.\scripts\dev-up.ps1

# 2. Abrir navegador
Start-Process "http://127.0.0.1:5173"

# 3. Validar:
#    - Tab "Resumen" arranca activa con tarjetas
#    - PtTable carga (paginada, 25/pp)
#    - Click un bloque → drill-down filtra la sidebar
#    - Click un PT → árbol con auto-expand + highlight
#    - Toggle Inventario/Requerimiento cambia los números grandes

# Detener
.\scripts\dev-down.ps1
```

## Validación automatizada con MCP chrome-devtools

Si tienes el MCP `chrome-devtools` cargado (los tools aparecen como `mcp__chrome-devtools__*`), puedes automatizar la validación.

### Pseudocódigo del flujo

```text
1. new_page("http://127.0.0.1:5173/")
2. wait_for(text=["Rastreabilidad BOM"])
3. evaluate_script:
     // verificar que cargó Resumen
     return document.querySelectorAll('button.group').length;   // tarjetas de bloques
4. evaluate_script:
     // click en el bloque "Doblez"
     const tarjetas = Array.from(document.querySelectorAll('button.group'));
     const doblez = tarjetas.find(b => b.textContent?.includes('Doblez'));
     doblez.click();
5. wait_for(text=["filtrado"])
6. evaluate_script:
     // click en el PT canónico
     const btns = Array.from(document.querySelectorAll('button'));
     const pt = btns.find(b => b.textContent?.includes('91711066-RA'));
     pt.click();
7. wait_for(text=["91711066-RA", "Hood W, Rear Engine"])
8. evaluate_script:
     // contar nodos del canvas
     return document.querySelectorAll('.react-flow__node').length;   // > 3 si auto-expandió
9. evaluate_script:
     // verificar mode default = inventario
     return document.body.textContent.includes('9 en buffer');       // c2
10. evaluate_script:
     // toggle a Requerimiento
     const req = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Requerimiento');
     req.click();
     return document.body.textContent.includes('213 por fabricar');
11. take_screenshot(...) para evidencia
12. list_console_messages(types=["error","warn"])  // debe ser []
```

**Importante**: `wait_for(text=[...])` puede devolver un snapshot enorme (5000+ líneas) cuando el listado tiene 2880 PTs. Es OK: el wait succeed (encontró el texto). No leas el snapshot completo — usa `evaluate_script` para verificaciones puntuales y `take_screenshot` para evidencia.

### Selectores estables

| Qué quieres | Cómo encontrarlo |
| --- | --- |
| Una fila del listado | `Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('<clave-pt>'))` |
| Una tarjeta del Resumen | `Array.from(document.querySelectorAll('button.group')).find(b => b.textContent?.includes('<nombre-proceso>'))` |
| Un tab | `document.querySelectorAll('[role="button"]')` filtrado por `textContent.startsWith('<clave>')` o `=== 'Resumen'` |
| Un nodo del canvas | `document.querySelectorAll('.react-flow__node-{tipo}')` donde tipo ∈ {pt, component, process} |
| El toggle de modo | `Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Inventario')` (o 'Requerimiento') |

**No** uses selectores basados en clases Tailwind (`.bg-status-pt`, etc.) — las clases se generan al build y pueden cambiar.

## Console limpia

Al final de cualquier validación visual, verificar:

```text
mcp__chrome-devtools__list_console_messages(types=["error","warn"])
→ "<no console messages found>"
```

Esto es el equivalente de "0 errores en tiempo de ejecución". Algunos warnings comunes que NO deberían aparecer:

- `Each child in a list should have a unique "key" prop` — bug nuestro.
- `Cannot read properties of undefined` — race condition o tipo mal.
- `Failed to load resource: 404` para `/api/*` — query rota.

`Failed to load resource: 404` con URL de `http://192.168.4.5/Dibujos/normal/*.jpg` es esperado: son las miniaturas que faltan en el server de dibujos. No bloquea.

## Si vas a agregar test suite automatizado

Opciones razonables y por qué cada una:

| Opción | Recomendada para | Setup |
| --- | --- | --- |
| **Vitest** | Unit tests de `lib/buildGraph`, `lib/layout`, `store/useUiStore` | `npm i -D vitest @testing-library/react jsdom` + `vitest.config.ts` + script `test`. |
| **Playwright** | Tests e2e contra dev server (flujo Resumen→Árbol vale el costo) | `npm init playwright@latest` — genera config + ejemplos. Necesita levantar backend + frontend. |
| **Storybook** | Visual regression de los nodos custom (3 tipos × N estados) | `npx storybook init` — pesado pero útil si la paleta de nodos crece. |

**Recomendación priorizada**:

1. **Vitest sobre `lib/buildGraph.ts`**: el caso "drill-down + auto-expand" es testable sin browser con fixtures sintéticas (`ArbolPT` + `HighlightFiltro` → `nodes` con `highlighted=true`).
2. **Playwright sobre el flujo Resumen→Árbol** una vez que cubras el algoritmo en backend + buildGraph en frontend con unit.
3. **Storybook** solo si el equipo crece o si se agregan más tipos de nodo.

Si lo agregas, sigue las convenciones:

- Tests en `frontend/src/**/*.test.{ts,tsx}` (junto al código que prueban).
- Script `test` en `package.json`.
- Agregar al smoke check post-cambio: `npm run typecheck && npm run test && npm run build`.

## Smoke check post-cambio (resumen)

Antes de marcar un cambio frontend como hecho:

```powershell
cd frontend
npm run typecheck
npm run build
```

Si tocaste algo del canvas, del flujo de datos o de la vista Resumen:

```powershell
# Levantar y validar visualmente
cd ..
.\scripts\dev-up.ps1
# (validar manualmente los 3 flujos A/B/C o con chrome-devtools)
.\scripts\dev-down.ps1
```
