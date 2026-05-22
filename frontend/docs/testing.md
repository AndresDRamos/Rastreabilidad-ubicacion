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

El "smoke test" oficial es navegar al **PT canónico 91711066-RA** (`Hood W, Rear Engine`, CNH Industrial America LLC). Cargado contra la BD real `192.168.4.5`, debe mostrar:

| Elemento | Modo Requerimiento | Modo Inventario |
| --- | --- | --- |
| Card PT `91711066-RA` | `222 pendientes`, badge `2 past-due` | `0 en piso` |
| Card componente `90358715-RA` (Angle, Strut) | `222 por fabricar`, status `Parcial` (naranja) | `0 en buffer` |
| Card componente `91711040-RA` (Hood, Engine Rear) | `213 por fabricar`, status `Parcial` (naranja) | `9 en buffer` |

Al expandir el componente `90358715-RA`:
- 2 nodos process en cadena: `Corte laser (0)` → `Doblez (4)` (modo Inventario) o `(218)` → `(218)` (modo Requerimiento).

Al expandir `91711040-RA`:
- 3 nodos process en cadena: `Corte (Punzonadora) (0)` → `Nivelado (0)` → `Doblez (0)` (modo Inventario), todos `(213)` en Requerimiento.

Estos son los mismos números que validan los tests `test_req_paso_caso_diagrama_usuario` (unit) y `test_arbol_pt_canonico_cuadra_con_diagrama` (e2e). Si no cuadran, **el algoritmo de netteo está roto** — no es un bug visual.

## Procedimiento de validación visual

```powershell
# 1. Levantar ambos
.\scripts\dev-up.ps1

# 2. Abrir navegador
Start-Process "http://127.0.0.1:5173"

# 3. En la sidebar, escribir "91711066" en "Numero de parte"
# 4. Click en el PT
# 5. Verificar los números esperados (tabla arriba)
# 6. Click toggle "Inventario"
# 7. Re-verificar números
# 8. Click en la card del componente 90358715-RA → debe expandir y mostrar Corte → Doblez
# 9. Click ▼ en la card del PT → debe expandir y mostrar Soldadura → Pintura → Embarques

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
     // click en el PT canónico
     const btns = Array.from(document.querySelectorAll('button'));
     const pt = btns.find(b => b.textContent?.includes('91711066-RA'));
     pt.click();
4. wait_for(text=["91711066-RA", "Hood W, Rear Engine"])
5. evaluate_script:
     // contar nodos del canvas
     return document.querySelectorAll('.react-flow__node').length;   // esperado: 3
6. evaluate_script:
     // toggle a Inventario y validar "9 en buffer"
     const inv = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Inventario');
     inv.click();
     return document.body.textContent.includes('9');
7. take_screenshot(...) para evidencia
8. list_console_messages(types=["error","warn"])  // debe ser []
```

**Importante**: `wait_for(text=[...])` puede devolver un snapshot enorme (5000+ líneas) cuando el listado tiene 2880 PTs. Es OK: el wait succeed (encontró el texto). No leas el snapshot completo — usa `evaluate_script` para verificaciones puntuales y `take_screenshot` para evidencia.

### Selectores estables

| Qué quieres | Cómo encontrarlo |
| --- | --- |
| Una fila del listado | `Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('<clave-pt>'))` |
| Un tab | `document.querySelectorAll('[role="button"]')` filtrado por `textContent.startsWith('<clave>')` |
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
- `Failed to load resource: 404` — favicon ya está inline, no debería pasar.

## Si vas a agregar test suite automatizado

Opciones razonables y por qué cada una:

| Opción | Recomendada para | Setup |
| --- | --- | --- |
| **Vitest** | Unit tests de `lib/buildGraph`, `lib/layout`, `store/useUiStore` | `npm i -D vitest @testing-library/react jsdom` + `vitest.config.ts` + script `test`. |
| **Playwright** | Tests e2e contra dev server | `npm init playwright@latest` — genera config + ejemplos. Necesita levantar backend + frontend. |
| **Storybook** | Visual regression de los nodos custom | `npx storybook init` — pesado pero útil si la paleta de nodos crece. |

**Recomendación**: empezar con Vitest para `lib/` y `store/` (puro, fácil), agregar Playwright cuando haya cambios de UI frecuentes. Storybook solo si el equipo crece.

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

Si tocaste algo del canvas o el flujo de datos:

```powershell
# Levantar y validar visualmente
cd ..
.\scripts\dev-up.ps1
# (validar manualmente o con chrome-devtools)
.\scripts\dev-down.ps1
```
