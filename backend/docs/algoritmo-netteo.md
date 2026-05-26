# backend/docs/algoritmo-netteo.md

> Cuándo cargar: cuando vayas a modificar `backend/src/rbom_api/domain/netteo.py`, agregar tests, o resolver un bug donde los números del árbol no cuadran con lo que el usuario espera.
>
> Este archivo es **autocontenido**: contiene todo lo necesario para entender el contrato del netteo sin tener que leer el reporte de fuente de datos externo.

## Modelo conceptual

Un PT (producto terminado) con demanda activa requiere fabricar componentes intermedios, que a su vez requieren otros componentes, hasta llegar a piezas que se compran o se producen desde materia prima. El backend integra **4 fuentes** de SQL Server EPS:

| Fuente | Tabla | Qué aporta |
| --- | --- | --- |
| DEMANDA | `EPS.dbo.tblDemandaEPS` | Piezas pendientes por (PT × Cliente × Ciudad). Past-due incluido sin piso de fecha. |
| BOM | `EPS.AppProc.tblBomExplosionado` | Árbol multinivel (`IdBomParent`, `IdPadre`, `BomLevel`, `CantidadEnsamble`). Filtro `IdTipoMaterial IN (1,3)` excluye MP/Dibujos/Indirectos/Herramental. Trae también `PrimerIdProceso` y `UltimoIdProceso` por componente para ayudar a la cadena de ruta. |
| RUTA | `tblMaterialRutaTiempo JOIN tblRuta JOIN tblProceso` | Secuencia de procesos por componente. `LEAD(idProceso) OVER (ORDER BY OrdenFabricacion)` infiere el siguiente paso. |
| WIP | `EPS.Produccion.tblEtiqueta` (`bActiva=1, idTipoEtiqueta=3`, `idEstatusEtiqueta IN (1,2)`) + `tblEtiquetaProceso` con `bUltimoProceso=1`, excluyendo etiquetas presentes en `vwEtiquetasEnRemision`. | **3 buckets** por `(idComp, idProceso)`: `Piezas/Etiquetas` (Por procesar, alimenta netteo), `PiezasLiberadas/EtiquetasLiberadas` (display), `PiezasInspeccion/EtiquetasInspeccion` (display). |

Las queries que producen estos result-sets son `backend/src/rbom_api/sql/Q_listado.sql` (un PT × Cliente × Ciudad por fila) y `backend/src/rbom_api/sql/Q_detalle.sql` (4 result-sets por PT).

### Interpretación de los 3 buckets WIP

| Bucket | Significado | ¿Alimenta netteo? |
| --- | --- | --- |
| **Por procesar** | `idProcesoSiguiente = idProceso ∧ estatus LIBERADO`. Piezas que terminaron el paso anterior y esperan entrar al proceso `idProceso`. | **Sí** — único bucket que descuenta demanda. |
| **Liberadas** | `bUltimoProceso=1 ∧ estatus LIBERADO`. Piezas que YA salieron del proceso `idProceso` y esperan al siguiente. | No (display). |
| **En Inspección** | `bUltimoProceso=1 ∧ estatus POR INSPECCION`. Piezas que pasaron por el proceso y siguen en QC. | No (display). |

**Regla dura**: si introduces una nueva métrica derivada del WIP, decide explícitamente si descuenta demanda y refleja la decisión en un test. La separación entre "alimenta netteo" y "display" está cubierta por `test_liberadas_e_inspeccion_no_afectan_req_paso`.

### Interpretación crítica del WIP "Por procesar"

Una etiqueta con `idProcesoSiguiente = X` significa que las piezas **terminaron el paso anterior y esperan entrar a X**. NO significa "piezas dentro del proceso X".

Esto define cómo se cuenta el WIP downstream en la pasada 2 del algoritmo.

## El algoritmo (`construir_arbol`)

`backend/src/rbom_api/domain/netteo.py` expone una sola función pública:

```python
def construir_arbol(
    demanda_filas: list[dict],
    bom_filas: list[FilaBom],
    ruta_filas: list[FilaRuta],
    wip_filas: list[FilaWip],
    almacen_wip_id: int,           # 16 por default
    almacen_wip_nombre: str,       # "Almacen WIP"
) -> ArbolPT
```

Internamente hace dos pasadas sobre la estructura combinada, precedidas por una consolidación de demanda multi-cliente.

### Pasada 0 — consolidación de demanda multi-cliente

Si el PT tiene demanda activa para varios `(Cliente, Ciudad)` (caso común en CNH/JD), las filas se agregan en una única `DemandaPT`:

- `PiezasPend = Σ PiezasPend` sobre todos los pares.
- `PiezasPastDue` idem.
- `Cliente`: si ≤ 3 distintos, se concatenan con `", "`; si más, `"N clientes"`. Idem `Ciudad`.
- `FechaPromMin = min(FechaPromMin_i)`, `FechaPromMax = max(FechaPromMax_i)`.
- `idCliente`/`idCiudad` quedan en `None` para señalizar el agregado.

Esto significa que **la card del PT raíz en el frontend siempre muestra un solo número**, aunque internamente la demanda venga de varios clientes. Si necesitas el breakdown por cliente, hay que cargarlo de `Q_detalle` antes de pasar por `construir_arbol`.

### Pasada 1 — top-down por orden topológico (Kahn)

Itera componentes del PT raíz hacia las hojas:

```text
req_bruto[PT_raíz] = demanda_total_del_PT  (suma sobre todos los Cliente/Ciudad)

para cada componente C en orden topológico:
    si C != PT_raíz:
        req_bruto[C] = Σ ( req_neto[padre] * CantidadEnsamble )
                       sobre TODAS las apariciones de C en el BOM
    req_neto[C] = max(0, req_bruto[C] - wip_total[C])
```

`wip_total[C] = Σ Piezas` solo del bucket **Por procesar** sobre todos los `idProceso` del componente. Las liberadas y en-inspección no entran en este total.

**Orden topológico (Kahn)**: garantiza que el padre se procesa antes que el hijo. La función `_topological_sort` lo implementa con grado de entrada. Falla con `ValueError` si detecta un ciclo (no debería pasar en BOMs válidos).

### Pasada 2 — ruta inversa por componente

Para cada componente C, los pasos de su ruta se procesan así:

**(a) Agrupar por `idProceso`** preservando el orden de primera aparición. Si una ruta tiene 4 sub-pasos con `idProceso=6` (caso real: Soldadura Robot + Limpieza + Soldadura Manual + …), se colapsan en UN solo `PasoRuta`. Las `Ruta` (nombre detallado) se concatenan con ` / `. Esta agrupación es **obligatoria** porque `tblEtiqueta.idProcesoSiguiente` solo indexa por idProceso (no por idRuta), así que hay un único valor de WIP por (componente, idProceso). Si no agruparas, contarías el mismo WIP varias veces en la pasada inversa.

**(b) Para intermedios**: agregar un `PasoRuta` virtual al final con `idProceso=almacen_wip_id (16)`, `es_virtual=True`. Representa el buffer donde el componente espera consumo por el padre. Su `wip_en_paso = wip[(idComp, 16)]` (bucket Por procesar). **No se renderiza como nodo** en el canvas; alimenta el `wipBuffer` de la card del componente.

**(c) Para el PT raíz**: NO agregar nodo virtual. El último paso del PT es típicamente Embarques (idProceso=13). La card del PT representa el estado final del producto.

**(d) Pasada inversa para `req_paso`**:

```text
acum_downstream = 0
para cada paso en orden INVERSO (último → primero):
    acum_downstream += paso.wip_en_paso       # solo bucket "Por procesar"
    paso.req_paso = max(0, req_bruto - acum_downstream)
```

Fórmula equivalente:

```text
req_paso[i] = req_bruto - Σ ( wip_en_paso[k] )   para k = i, i+1, ..., último
              ↑                                   (inclusivo del paso actual)
              piezas que aún deben pasar por este step
```

**Por qué inclusivo**: las piezas que están en el paso `i` (WIP con `idProcesoSiguiente = idProceso_de_i`) ya completaron los pasos previos a `i`. Por eso no se cuentan upstream de `i`. Y se cuentan en `i` porque aún les falta entrar al proceso.

**(e) Hidratación de campos display**: cada `PasoRuta` también recibe `liberadas`, `etiquetas_liberadas`, `en_inspeccion`, `etiquetas_inspeccion` extraídos del mismo `FilaWip`. Estos viajan al frontend pero **no afectan el cálculo de `req_paso`**.

## Componentes shared (apariciones múltiples)

Un mismo `idComp` puede aparecer bajo varios padres en `tblBomExplosionado`. Por ejemplo, el componente `16821455` es hijo simultáneo de `16846193` y `16846195`.

- `req_bruto[16821455]` **SUMA** todas las contribuciones de sus padres.
- `wip_total[16821455]` se descuenta **UNA SOLA VEZ** (el WIP físico no se duplica).
- El nodo aparece **una sola vez** en el árbol, pero con varias aristas hijo → padre (una por aparición).

Este caso está cubierto explícitamente por el test `test_componente_compartido_suma_req_bruto`.

## Buffer virtual `Almacen WIP` (idProceso=16)

Para **intermedios** (no PT raíz), se agrega como último `PasoRuta` un nodo virtual con:

```python
PasoRuta(
    orden=len(pasos) + 1,
    idProceso=almacen_wip_id,          # 16
    proceso=almacen_wip_nombre,        # "Almacen WIP"
    ruta=None,
    idPlanta=None,
    es_virtual=True,
    wip_en_paso=wip_por_paso.get((idComp, almacen_wip_id), 0.0),
    etiquetas_en_paso=...,
    liberadas=0.0,                     # no aplica: idProceso=16 no tiene bUltimoProceso=1
    etiquetas_liberadas=0,
    en_inspeccion=0.0,
    etiquetas_inspeccion=0,
    req_paso=0.0,                      # se calcula en la pasada inversa
    label="",                          # se construye al final
)
```

**Semánticamente**: representa el buffer donde el componente espera ser consumido por su padre. Las piezas que llegan ahí ya terminaron toda la ruta de fabricación del componente.

**En el frontend**:

- `frontend/src/lib/buildGraph.ts` extrae `wipBuffer = ultimo_paso.wip_en_paso` cuando `es_virtual=true`.
- `reqBufferFaltante = max(0, req_bruto - wipBuffer)` es lo que muestra la card en modo Requerimiento.
- El paso virtual **no se renderiza como nodo visible** aunque el componente esté expandido — alimenta la card.

## Outliers operativos (advertencias)

A veces hay etiquetas activas en procesos que **no aparecen en la ruta catalogada** del componente (re-trabajos, desviaciones, errores de captura). El algoritmo los detecta:

```python
procesos_en_ruta = {p.idProceso for p in pasos}
for (comp_id, proc_id), pzs in wip_por_paso.items():
    if comp_id == idComp and proc_id not in procesos_en_ruta and pzs > 0:
        advertencias.append(
            f"{fb.Componente}: {pzs} pzs WIP en idProceso={proc_id} "
            f"fuera de la ruta catalogo (revisar)"
        )
```

Las advertencias viajan en `ArbolPT.advertencias` y el frontend puede mostrarlas en un panel separado (hoy no se renderizan, pero el campo está). Estimado: ~5% de los componentes con WIP tienen al menos una advertencia.

## Catálogo de `idProceso` relevantes

Subconjunto de `EPS.dbo.tblProceso` que aparece en árboles típicos:

| idProceso | Nombre | Notas |
| --- | --- | --- |
| 3 | Corte | En planeación se identifica como `3-{idRuta}` (Corte Láser=9, Plasma, Punzonado son recursos distintos del mismo idProceso). |
| 4 | Doblez | |
| 5 | Maquinado | |
| 6 | Soldadura | Varios sub-pasos comparten esta idProceso (Robot, Limpieza, Manual). **Agrupar es obligatorio.** |
| 7 | Pintura | |
| 9 | Ensamblado | |
| 10 | Proceso Externo | Maquilas, subcontratistas. |
| 12 | Op Secundarias | |
| 13 | Embarques | `OrdenProceso=9999`. Típicamente último paso del PT. |
| **16** | **Almacen wip** | `ALMACEN_WIP_PROCESO_ID`: buffer universal. Para el PT cuando empieza con ARMADO DE KITS, es el primer paso REAL. Para intermedios, es el nodo virtual al final (no se renderiza). |
| 18 | Nivelado | |
| 19 | Estampado | |
| 23 | Corte 2da-op | idProceso DISTINTO del 3, no confundir. |
| 44 | Limpieza | idProceso DISTINTO del 6. |

## Las 15 trampas conocidas

| # | Trampa | Mitigación |
| --- | --- | --- |
| 1 | `tblBomTiempo` cubre solo 28% del top de demanda activa (última mod 2019-10). | Usar `tblBomExplosionado` (99%) + `tblMaterialRutaTiempo` (99%). Reconstruir `idProcesoSiguiente` con `LEAD()`. |
| 2 | `IdTipoMaterial=8` (Dibujos) aparece como hijo en BOM (caso `CF-3595973C3-RC` en PT 24013). | Filtrar SIEMPRE explícito `IdTipoMaterial IN (1,3)`. 6=Indirectos, 7=Dibujos variante, 8=Dibujos, 2=MP. |
| 3 | `tblCliente.NombreCliente` (NO `nombre`). | Schema verificado en producción. |
| 4 | `tblCiudad.Ciudad` (NO `NombreCiudad`). | Schema verificado. |
| 5 | `idRutaProcesoSiguiente = 0` constante en `tblEtiqueta`. | No discrimina ruta cuando varios pasos comparten idProceso. Mitigado por agrupación: el WIP se trata como único por idProceso. |
| 6 | Past-due se filtra por error con `BETWEEN today AND future`. | Usar solo techo superior: `WHERE Fecha <= DATEADD(MONTH, N, GETDATE())`. Past-due es prioridad máxima. |
| 7 | Componentes compartidos entre padres (caso `16821455` bajo `16846193` y `16846195`). | `req_bruto` suma; `wip_total` se descuenta una vez. La pasada 1 ya lo maneja. |
| 8 | Outliers operativos (~5% WIP fuera de catálogo) — desviaciones, re-trabajos. | Emitir como `advertencias[]` sin bloquear. |
| 9 | Navegación de jerarquía: no fiarse solo de `BomLevel`. | Usar `IdBomParent` y `IdPadre` para reconstruir el árbol; `BomLevel` puede repetirse para shared components. |
| 10 | WIP keyed por `(idMaterial, idProcesoSiguiente)`: piezas esperando ENTRAR al proceso, NO piezas DENTRO del proceso. | El algoritmo trata `wip_en_paso[i]` como "piezas posicionadas downstream del paso anterior, listas para i". |
| 11 | Multi-planta dentro de una ruta es normal (caso PT 49178: P4→P4→P5→P4→P1). | Ignorar planta para el árbol; mostrar como dato informativo en UI (`PasoRuta.idPlanta`). |
| 12 | Agrupación de sub-pasos por idProceso (caso PT 91711066-RA: Soldadura Robot + Limpieza + Manual = 3 sub-pasos con idProceso=6). | Colapsar en un solo `PasoRuta`. Si no, el WIP se cuenta varias veces (bug grave). |
| 13 | Para intermedios: nodo virtual `Almacen WIP` (idProceso=16) al final de la ruta. | Modela el buffer donde el componente espera consumo. NO se renderiza como nodo; su data va en la card. |
| 14 | Para PT raíz: NO nodo virtual. | El PT termina en Embarques (típicamente). La card del PT muestra demanda total. |
| 15 | `tblBomExplosionado.IdMaterial` = PT raíz, `IdComponent` = el componente en este nivel. | Para el PT raíz mismo: `IdBom=1`, `IdBomParent=NULL`, `IdPadre=NULL`, `IdComponent = IdMaterial` (autorreferencia). |

### Trampas adicionales (post-3-buckets)

| # | Trampa | Mitigación |
| --- | --- | --- |
| 16 | Mezclar buckets WIP en el netteo (sumar Liberadas o Inspección a la fórmula de `req_paso`). | El test `test_liberadas_e_inspeccion_no_afectan_req_paso` lo fija: solo `Piezas` (bucket Por procesar) entra al cálculo. |
| 17 | Etiqueta ya remisionada pero `bActiva=1` aún. | `Q_detalle.sql` y `Q_bloques.sql` aplican `NOT EXISTS (SELECT 1 FROM vwEtiquetasEnRemision)` — la sola presencia en esa vista implica compromiso. |
| 18 | UNION ALL en el CTE de buckets duplica filas si un proceso fuera a la vez "siguiente" y "último" para la misma etiqueta. | Por construcción no ocurre: si `idProcesoSiguiente = X` entonces el último proceso histórico ≠ X. Validado en `Q_detalle.sql`. |

## Caso canónico — PT 91711066-RA

Validado contra BD real y con el diagrama Excalidraw del usuario. Es el "regression test visual" del sistema.

**PT**: `91711066-RA` (Hood W, Rear Engine), CNH Industrial America LLC, LEBANON/WICHITA, **222 piezas pendientes**.

**Dos hijos directos (nivel 2)**:

| Componente | Clave | Ruta | WIP físico | Resultados esperados |
| --- | --- | --- | --- | --- |
| Hijo 1 | `90358715-RA` (Angle, Strut) | Corte láser → Doblez | 4 pzs esperando Doblez | `req_paso[Corte] = 218`, `req_paso[Doblez] = 218`, `req_paso[buffer virtual] = 222` |
| Hijo 2 | `91711040-RA` (Hood, Engine Rear) | Corte láser → Nivelado → Doblez | 9 pzs en Almacén WIP (post-Doblez) | `req_paso[Corte] = 213`, `req_paso[Nivelado] = 213`, `req_paso[Doblez] = 213`, `req_paso[buffer virtual] = 213` |

**Card del componente** (modo Inventario, número grande):

- `90358715-RA` card: `wipBuffer = 0` (las 4 piezas están en Doblez, no en el buffer)
- `91711040-RA` card: `wipBuffer = 9`

**Card del componente** (modo Requerimiento):

- `90358715-RA` card: `reqBufferFaltante = 222 - 0 = 222`
- `91711040-RA` card: `reqBufferFaltante = 222 - 9 = 213`

Este caso está cubierto explícitamente por:

- `test_req_paso_caso_diagrama_usuario` en `tests/unit/test_netteo.py` (sin BD, datos sintéticos).
- `test_arbol_pt_canonico_cuadra_con_diagrama` en `tests/e2e/test_arbol_real.py` (contra BD real, si `RBOM_E2E_PT_ID` está configurado).

## Performance esperada

Validada en producción contra SQL Server EPS:

| Operación | Latencia típica | Comentario |
| --- | --- | --- |
| `Q_listado.sql` (3 meses) | <500 ms | ~500-1000 filas para top-100. Cacheado 5 min en `routers/pts.py`. |
| `Q_detalle.sql` (PT pequeño, 1-5 componentes) | 100-300 ms | |
| `Q_detalle.sql` (PT grande, 50+ intermedios) | 1-3 s | PT 60762 con 73 intermedios tomó ~2 s. |
| `Q_bloques.sql` (sin filtros) | <800 ms | Cacheado 2 min. |
| `Q_pts_en_proceso.sql` (1 proceso) | <600 ms | Cacheado 2 min. |
| `construir_arbol()` (en memoria) | <50 ms incluso para árboles de 100+ componentes | |

Si algún PT pasa de 30 s, considerar paginación de BOM o vista materializada — pero esto no ha ocurrido aún.

## Lo que NO está en el algoritmo

- **No corre forecast hacia adelante**: el netteo es un snapshot del estado actual de inventario vs demanda. No proyecta consumo futuro ni capacidad de producción.
- **No considera stock de materia prima**: el BOM se corta en `IdTipoMaterial IN (1,3)` (PT + Intermedios). MP queda fuera porque su trazabilidad vive en otro sistema.
- **No considera tiempos**: `tblMaterialRutaTiempo.TiempoProceso` existe en el response (`FilaRuta.TiempoProceso`), pero no se usa para programación. Si en el futuro se quiere mostrar ETA, hay que propagarlo a `PasoRuta` y a `ProcessNode`.
- **No re-calcula al editar etiquetas**: si un operador captura/elimina una etiqueta WIP, el frontend no recibe push. Hay que refrescar manualmente (recargar tab) para invalidar el cache de TanStack.
- **No combina liberadas/inspección con `req_paso`**: son métricas de display. Si en algún momento el negocio decide que las "Liberadas" cuentan como WIP disponible para el padre, modificar `_construir_pasos` y actualizar el test correspondiente.
