-- =============================================================================
-- Q_flujo_plantas.sql  -  Vista Flujo, nivel PLANTA (overview).
--
-- Es el nivel agregado del Flujo: en vez de un bloque por (proceso x planta),
-- aqui hay UN bloque por planta, y las aristas son Planta A -> Planta B (el
-- material que cruza de una planta a otra). El usuario hace drill-in a una
-- planta para ver su grafo interno de procesos (eso lo sirve Q_flujo.sql con
-- ?planta=).
--
-- Igual que Q_flujo.sql: la ESTRUCTURA sale de las RUTAS de fabricacion
-- (incluye aristas en cero) y el WIP se SOBREPONE con LEFT JOIN.
--
-- Devuelve 2 result-sets:
--   (A) NODOS  -> una fila por planta con su WIP interno total (suma de todos
--                 sus procesos), su Rango (mediana de OrdenFabricacion de sus
--                 pasos -> ordena izquierda(fabricacion) -> derecha(embarque))
--                 y cuantos procesos corre.
--   (B) ARISTAS -> una fila por (plantaOrigen -> plantaDestino) con el material
--                 liberado en la planta origen cuyo siguiente proceso vive en la
--                 planta destino (= PorTransferir interplanta). 0 si no hay.
--
-- El "material que se va A -> B" es el analogo interplanta del PorTransferir del
-- flujo de procesos: una etiqueta fisicamente en A (idPlantaProceso=A), liberada
-- (estatus=2), cuyo proximo proceso (idProcesoSiguiente) se ejecuta en B. La
-- planta destino se resuelve contra la ruta del componente.
--
-- El universo de componentes (#comp) siempre acota a PTs con demanda activa.
--
-- Parametros (NULL = sin filtro):
--   (No hay @idPlantaFiltro: el overview muestra TODAS las plantas.)
--
-- Placeholders reemplazados desde Python (identicos a Q_flujo.sql):
--   /*CLIENTES_FILTER*/   "AND d.idCliente IN (...)" o "".
--   /*CIUDADES_FILTER*/   "AND d.idCiudad IN (...)" o "".
--   /*CLASE_FILTER*/      "AND I.CLASS_ID_ARTCULO_ID IN (...)" o "".
--   /*PT_UNIVERSO_FILTER*/ "AND d.idMaterial IN (...)" o ""  (Caterpillar CSV).
--   /*TIPOMAT_FILTER*/    "AND m.idTipoMaterial IN (...)" o "".
-- =============================================================================

SET NOCOUNT ON;

-- (0) Universo de componentes (PTs con demanda activa -> sus PT/Intermedios) ---
;WITH cteDem AS
(
    SELECT DISTINCT d.idMaterial AS idPT
    FROM EPS.dbo.tblDemandaEPS d
    LEFT JOIN NETSUITE.dbo.ITEMS I ON I.ITEM_ID = d.ItemID
    WHERE d.bActivo = 1
        AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
    /*CLIENTES_FILTER*/
    /*CIUDADES_FILTER*/
    /*CLASE_FILTER*/
    /*PT_UNIVERSO_FILTER*/
)
SELECT DISTINCT b.IdComponent AS idComp
INTO #comp
FROM EPS.AppProc.tblBomExplosionado b
JOIN cteDem d ON b.IdMaterial = d.idPT
JOIN EPS.dbo.tblMaterial m ON b.IdComponent = m.idMaterial
WHERE b.IdTipoMaterial IN (1, 3)
/*TIPOMAT_FILTER*/;

-- (1) Estructura: ruta de cada componente con planta y planta siguiente. -------
SELECT
     mrt.idMaterial AS idComp
    ,p.idProceso
    ,mrt.IdPlanta   AS idPlanta
    ,mrt.OrdenFabricacion
    ,LEAD(mrt.IdPlanta) OVER (
        PARTITION BY mrt.idMaterial ORDER BY mrt.OrdenFabricacion
     )              AS idPlantaSig
INTO #ruta
FROM EPS.dbo.tblMaterialRutaTiempo mrt
JOIN EPS.dbo.tblRuta r    ON mrt.idRuta = r.idRuta
JOIN EPS.dbo.tblProceso p ON r.idProceso = p.idProceso
WHERE EXISTS (SELECT 1 FROM #comp c WHERE c.idComp = mrt.idMaterial);

-- (1b) Rango de cada planta = mediana de OrdenFabricacion de sus pasos. Ordena
-- las plantas izquierda (fabricacion temprana) -> derecha (embarque/tardio).
SELECT DISTINCT
     idPlanta
    ,PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY OrdenFabricacion)
        OVER (PARTITION BY idPlanta) AS Rango
INTO #rangoPlanta
FROM #ruta;

-- (2) WIP: etiquetas activas de esos componentes. -----------------------------
SELECT
     e.idEtiqueta
    ,e.idMaterial
    ,e.cantidad
    ,e.idEstatusEtiqueta
    ,e.idProcesoSiguiente
    ,e.idPlantaProceso AS idPlanta
    ,u.idProceso       AS procesoUbicacion
    ,ep.idProceso      AS procesoActual
INTO #etiq
FROM EPS.Produccion.tblEtiqueta e
LEFT JOIN EPS.Produccion.tblUbicacion u ON e.idUbicacion = u.idUbicacion
LEFT JOIN EPS.Produccion.tblEtiquetaProceso ep
       ON ep.idEtiqueta = e.idEtiqueta
      AND ep.bUltimoProceso = 1
WHERE e.bActiva           = 1
    AND e.idTipoEtiqueta    = 3
    AND e.idEstatusEtiqueta IN (1, 2, 5)
    AND NOT EXISTS (
        SELECT 1 FROM EPS.dbo.vwEtiquetasEnRemision red
        WHERE red.idEtiqueta = e.idEtiqueta
    )
    AND EXISTS (SELECT 1 FROM #comp c WHERE c.idComp = e.idMaterial);

-- (3) WIP interplanta: una fila por etiqueta liberada cuyo siguiente proceso
--     vive en OTRA planta. La planta destino se resuelve contra la ruta del
--     componente (preferimos una planta distinta a la actual si hay varias). ---
SELECT
     e.idPlanta AS idPlantaOrigen
    ,dest.idPlantaDestino
    ,e.cantidad
    ,e.idEtiqueta
INTO #edgePlanta
FROM #etiq e
CROSS APPLY (
    SELECT TOP 1 rr.idPlanta AS idPlantaDestino
    FROM #ruta rr
    WHERE rr.idComp = e.idMaterial
      AND rr.idProceso = e.idProcesoSiguiente
    ORDER BY CASE WHEN rr.idPlanta <> e.idPlanta THEN 0 ELSE 1 END, rr.idPlanta
) dest
WHERE e.idEstatusEtiqueta = 2
  AND e.procesoActual IS NOT NULL
  AND e.idProcesoSiguiente IS NOT NULL
  AND dest.idPlantaDestino <> e.idPlanta;

-- ===== Result-set (A): NODOS por planta ======================================
SELECT
     n.idPlanta
    ,pl.Nombre              AS NombrePlanta
    ,rp.Rango               AS Rango
    ,ISNULL(w.Recibidas, 0)   AS Recibidas
    ,ISNULL(w.Disponibles, 0) AS Disponibles
    ,ISNULL(w.Inspeccion, 0)  AS Inspeccion
    ,ISNULL(w.Retrabajo, 0)   AS Retrabajo
    ,ISNULL(w.Etiquetas, 0)   AS Etiquetas
    ,ISNULL(w.Materiales, 0)  AS Materiales
    ,(SELECT COUNT(DISTINCT rr.idProceso) FROM #ruta rr WHERE rr.idPlanta = n.idPlanta) AS Procesos
FROM (SELECT DISTINCT idPlanta FROM #ruta UNION SELECT DISTINCT idPlanta FROM #etiq) n
LEFT JOIN EPS.dbo.tblPlanta pl ON pl.idPlanta = n.idPlanta
LEFT JOIN #rangoPlanta rp ON rp.idPlanta = n.idPlanta
LEFT JOIN (
    SELECT
         idPlanta
        ,SUM(CASE WHEN bucket = 'Recibidas'   THEN cantidad ELSE 0 END) AS Recibidas
        ,SUM(CASE WHEN bucket = 'Disponibles' THEN cantidad ELSE 0 END) AS Disponibles
        ,SUM(CASE WHEN bucket = 'Inspeccion'  THEN cantidad ELSE 0 END) AS Inspeccion
        ,SUM(CASE WHEN bucket = 'Retrabajo'   THEN cantidad ELSE 0 END) AS Retrabajo
        ,COUNT(DISTINCT idEtiqueta) AS Etiquetas
        ,COUNT(DISTINCT idMaterial) AS Materiales
    FROM (
        SELECT idPlanta, cantidad, idEtiqueta, idMaterial, CAST('Disponibles' AS varchar(20)) AS bucket
        FROM #etiq
        WHERE idEstatusEtiqueta = 2 AND idProcesoSiguiente IS NOT NULL
          AND (procesoUbicacion IS NULL OR procesoUbicacion <> idProcesoSiguiente)
        UNION ALL
        SELECT idPlanta, cantidad, idEtiqueta, idMaterial, CAST('Recibidas' AS varchar(20))
        FROM #etiq
        WHERE idEstatusEtiqueta = 2 AND idProcesoSiguiente IS NOT NULL
          AND procesoUbicacion = idProcesoSiguiente
        UNION ALL
        SELECT idPlanta, cantidad, idEtiqueta, idMaterial, CAST('Inspeccion' AS varchar(20))
        FROM #etiq WHERE idEstatusEtiqueta = 1 AND procesoActual IS NOT NULL
        UNION ALL
        SELECT idPlanta, cantidad, idEtiqueta, idMaterial, CAST('Retrabajo' AS varchar(20))
        FROM #etiq WHERE idEstatusEtiqueta = 5 AND procesoActual IS NOT NULL
    ) ub
    GROUP BY idPlanta
) w ON w.idPlanta = n.idPlanta
ORDER BY rp.Rango, n.idPlanta;

-- ===== Result-set (B): ARISTAS interplanta (ruta + WIP huerfano) =============
-- `Componentes` = cuantos componentes RUTAN A->B (peso estructural del flujo,
-- alimenta el grosor de la arista). `Piezas` = material en transito A->B ahora
-- mismo (alimenta el color/animacion). Una arista existe si tiene estructura
-- O WIP en transito.
;WITH rutaTrans AS
(
    SELECT idComp, idPlanta AS idPlantaOrigen, idPlantaSig AS idPlantaDestino
    FROM #ruta
    WHERE idPlantaSig IS NOT NULL AND idPlanta <> idPlantaSig
)
,estructura AS
(
    SELECT DISTINCT idPlantaOrigen, idPlantaDestino FROM rutaTrans
    UNION
    SELECT DISTINCT idPlantaOrigen, idPlantaDestino FROM #edgePlanta
)
SELECT
     a.idPlantaOrigen
    ,ISNULL(plo.Nombre, '(sin planta)') AS PlantaOrigen
    ,a.idPlantaDestino
    ,ISNULL(pld.Nombre, '(sin planta)') AS PlantaDestino
    ,ISNULL(w.Piezas, 0)        AS Piezas
    ,ISNULL(w.Etiquetas, 0)     AS Etiquetas
    ,ISNULL(rc.Componentes, 0)  AS Componentes
FROM estructura a
LEFT JOIN (
    SELECT idPlantaOrigen, idPlantaDestino,
           SUM(cantidad) AS Piezas, COUNT(DISTINCT idEtiqueta) AS Etiquetas
    FROM #edgePlanta
    GROUP BY idPlantaOrigen, idPlantaDestino
) w ON w.idPlantaOrigen = a.idPlantaOrigen AND w.idPlantaDestino = a.idPlantaDestino
LEFT JOIN (
    SELECT idPlantaOrigen, idPlantaDestino, COUNT(DISTINCT idComp) AS Componentes
    FROM rutaTrans
    GROUP BY idPlantaOrigen, idPlantaDestino
) rc ON rc.idPlantaOrigen = a.idPlantaOrigen AND rc.idPlantaDestino = a.idPlantaDestino
LEFT JOIN EPS.dbo.tblPlanta plo ON plo.idPlanta = a.idPlantaOrigen
LEFT JOIN EPS.dbo.tblPlanta pld ON pld.idPlanta = a.idPlantaDestino
ORDER BY Componentes DESC, Piezas DESC;

DROP TABLE #comp, #ruta, #rangoPlanta, #etiq, #edgePlanta;
