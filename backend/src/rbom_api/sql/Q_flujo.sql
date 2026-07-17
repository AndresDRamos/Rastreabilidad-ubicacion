-- =============================================================================
-- Q_flujo.sql  -  Vista Flujo (drill-in de una planta): grafo de procesos.
--
-- A diferencia de Q_bloques (que solo muestra procesos CON WIP), aqui la
-- ESTRUCTURA (que procesos y en que orden) sale de las RUTAS de fabricacion de
-- los componentes del universo, y el WIP se SOBREPONE. Asi se ve la ruta
-- completa, incluyendo bloques y aristas en cero.
--
-- DOS conceptos nuevos respecto a la version por-proceso simple:
--
--  (1) FASES. Un mismo proceso puede aparecer VARIAS veces en la ruta de un
--      componente (ej. Corte -> Doblez -> Corte). Cada aparicion NO-consecutiva
--      es una FASE distinta (Corte 1a, Corte 2a) y se dibuja como un nodo
--      distinto, para que el flujo se lea de izquierda a derecha sin lineas de
--      retorno. Las corridas consecutivas del mismo proceso (Maquinado x3
--      seguidos) se COLAPSAN a una sola fase. El WIP en vivo se atribuye a la
--      fase correcta resolviendo la transicion de cada etiqueta (de donde viene
--      -> a donde va) contra las aristas de ruta ya fraccionadas por fase.
--
--  (2) PUERTAS INTERPLANTA. La ruta cruza de planta (Corte@P4 -> Doblez@P1).
--      En el drill-in de una planta P, esas transiciones NO se descartan: la
--      operacion del otro lado se representa como un nodo-PUERTA (una por planta
--      externa x direccion). Entrada a la izquierda, salida a la derecha. Asi
--      ningun nodo queda huerfano (ej. Ensamblado@P1 alimentado solo desde P4)
--      y se ve "que proceso surte la planta A a la planta B".
--
-- Devuelve 2 result-sets:
--   (A) BLOQUES  -> nodos de proceso (idProceso, idPlanta, Fase) + nodos-puerta.
--   (B) ARISTAS  -> transiciones (con fase de cada extremo) + aristas de puerta.
--
-- Reglas de buckets (identicas a Q_bloques.sql, ahora atribuidas por fase):
--   Recibidas     estatus=2, sig=Y, ubic=Y
--   Disponibles   estatus=2, sig=Y, ubic<>Y      (= SUM aristas entrantes a Y)
--   PorTransferir estatus=2, procActual=X, sig=Y<>X, ubic<>Y   (arista X->Y)
--   Inspeccion    estatus=1, procActual=Y
--   Retrabajo     estatus=5, procActual=Y
--
-- El universo de componentes (#comp) siempre acota a PTs con demanda activa.
--
-- Parametros (NULL = sin filtro):
--   @idPlantaFiltro  int   Planta del drill-in. NULL = sin puertas, todos los
--                          nodos (usado poco: el drill siempre pasa una planta).
--
-- Placeholders reemplazados desde Python:
--   /*CLIENTES_FILTER*/   "AND d.idCliente IN (...)" o "".
--   /*CIUDADES_FILTER*/   "AND d.idCiudad IN (...)" o "".
--   /*CLASE_FILTER*/      "AND I.CLASS_ID_ARTCULO_ID IN (...)" o "".
--   /*PT_UNIVERSO_FILTER*/ "AND d.idMaterial IN (...)" o ""  (Caterpillar CSV).
--   /*TIPOMAT_FILTER*/    "AND m.idTipoMaterial IN (...)" o "".
-- =============================================================================

SET NOCOUNT ON;

DECLARE @idPlantaFiltro int = @idPlantaFiltro;

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

-- (1) Pasos crudos de la ruta, COMPLETOS (sin filtro de planta: las fases y las
--     puertas necesitan ver la ruta entera para ser consistentes). ------------
SELECT
     mrt.idMaterial    AS idComp
    ,mrt.OrdenFabricacion AS orden
    ,mrt.IdPlanta      AS idPlanta
    ,p.idProceso
INTO #raw
FROM EPS.dbo.tblMaterialRutaTiempo mrt
JOIN EPS.dbo.tblRuta r    ON mrt.idRuta = r.idRuta
JOIN EPS.dbo.tblProceso p ON r.idProceso = p.idProceso
WHERE EXISTS (SELECT 1 FROM #comp c WHERE c.idComp = mrt.idMaterial);

-- (2) Colapsar corridas consecutivas del mismo (idProceso, idPlanta) en UNA sola
--     aparicion (gaps-and-islands) y numerar la FASE = k-esima aparicion del
--     proceso en la ruta (independiente de la planta). --------------------------
;WITH grp AS
(
    SELECT idComp, orden, idPlanta, idProceso,
        ROW_NUMBER() OVER (PARTITION BY idComp ORDER BY orden)
      - ROW_NUMBER() OVER (PARTITION BY idComp, idProceso, idPlanta ORDER BY orden) AS g
    FROM #raw
),
runs AS
(
    SELECT idComp, idProceso, idPlanta, MIN(orden) AS ordenRun
    FROM grp
    GROUP BY idComp, idProceso, idPlanta, g
)
SELECT
     idComp, idProceso, idPlanta, ordenRun
    ,CAST(ROW_NUMBER() OVER (PARTITION BY idComp, idProceso ORDER BY ordenRun) AS int) AS Fase
INTO #run
FROM runs;

-- (3) Aristas de la ruta = transicion de un run al siguiente (por OrdenFabric.).
--     Cada extremo lleva su (idProceso, idPlanta, Fase). ------------------------
SELECT
     idComp
    ,idProceso AS idProcOrigen
    ,idPlanta  AS plantaOrigen
    ,Fase      AS faseOrigen
    ,LEAD(idProceso) OVER (PARTITION BY idComp ORDER BY ordenRun) AS idProcDestino
    ,LEAD(idPlanta)  OVER (PARTITION BY idComp ORDER BY ordenRun) AS plantaDestino
    ,LEAD(Fase)      OVER (PARTITION BY idComp ORDER BY ordenRun) AS faseDestino
INTO #edge
FROM #run;

-- (4) Rango: mediana de OrdenFabricacion por (idProceso, idPlanta, Fase). Ordena
--     columnas izquierda(temprano) -> derecha(tardio); la 2a fase cae a la
--     derecha de la 1a. ---------------------------------------------------------
SELECT DISTINCT
     idProceso, idPlanta, Fase
    ,PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ordenRun)
        OVER (PARTITION BY idProceso, idPlanta, Fase) AS Rango
INTO #rango
FROM #run;

-- (5) WIP: etiquetas activas de esos componentes, TODAS las plantas (el material
--     en transito interplanta vive fisicamente en la planta de origen). ---------
SELECT
     e.idEtiqueta
    ,e.idMaterial
    ,e.cantidad
    ,e.idEstatusEtiqueta
    ,e.idProcesoSiguiente
    ,e.idPlantaProceso AS idPlantaEtiq     -- planta fisica (fallback si la etiqueta no matchea ruta)
    ,u.idProceso  AS procesoUbicacion
    ,ep.idProceso AS procesoActual
INTO #etiq
FROM EPS.Produccion.tblEtiqueta e
LEFT JOIN EPS.Produccion.tblUbicacion u ON e.idUbicacion = u.idUbicacion
LEFT JOIN EPS.Produccion.tblEtiquetaProceso ep
       ON ep.idEtiqueta = e.idEtiqueta
      AND ep.bUltimoProceso = 1
WHERE e.bActiva           = 1
    AND e.idTipoEtiqueta    = 3              -- LIBERACION
    AND e.idEstatusEtiqueta IN (1, 2, 5)      -- POR INSPECCION / LIBERADO / POR RETRABAJO
    AND NOT EXISTS (
        SELECT 1 FROM EPS.dbo.vwEtiquetasEnRemision red
        WHERE red.idEtiqueta = e.idEtiqueta
    )
    AND EXISTS (SELECT 1 FROM #comp c WHERE c.idComp = e.idMaterial);

-- (6) Resolver cada etiqueta a su FASE/PLANTA de nodo, contra la ruta de SU
--     material. Preferimos la transicion exacta (procesoActual -> sig) para
--     desambiguar la fase; si no matchea, caemos a la 1a fase del proceso en la
--     ruta de ese material. -----------------------------------------------------
SELECT
     e.idEtiqueta, e.idMaterial, e.cantidad, e.idEstatusEtiqueta
    ,e.idProcesoSiguiente, e.procesoUbicacion, e.procesoActual, e.idPlantaEtiq
    -- nodo DESTINO (al que va la etiqueta): idProceso = idProcesoSiguiente
    ,COALESCE(em.plantaDestino, dst.idPlanta) AS dstPlanta
    ,COALESCE(em.faseDestino,   dst.Fase)     AS dstFase
    -- nodo FISICO (donde esta): idProceso = procesoActual
    ,COALESCE(em.plantaOrigen,  src.idPlanta) AS srcPlanta
    ,COALESCE(em.faseOrigen,    src.Fase)     AS srcFase
    -- arista de transito matcheada (para PorTransferir X->Y). NULL si no matchea.
    ,em.idProcOrigen  AS emProcO, em.plantaOrigen AS emPlantaO, em.faseOrigen AS emFaseO
    ,em.idProcDestino AS emProcD, em.plantaDestino AS emPlantaD, em.faseDestino AS emFaseD
INTO #ea
FROM #etiq e
OUTER APPLY (
    SELECT TOP 1 r.idPlanta, r.Fase FROM #run r
    WHERE r.idComp = e.idMaterial AND r.idProceso = e.idProcesoSiguiente
    ORDER BY r.Fase
) dst
OUTER APPLY (
    SELECT TOP 1 r.idPlanta, r.Fase FROM #run r
    WHERE r.idComp = e.idMaterial AND r.idProceso = e.procesoActual
    ORDER BY r.Fase
) src
OUTER APPLY (
    SELECT TOP 1 ed.* FROM #edge ed
    WHERE ed.idComp = e.idMaterial
      AND ed.idProcOrigen  = e.procesoActual
      AND ed.idProcDestino = e.idProcesoSiguiente
    ORDER BY ed.faseOrigen
) em;

-- (7) WIP por NODO (idProceso, idPlanta, Fase). --------------------------------
SELECT
     u.idProceso
    ,u.idPlanta
    ,u.Fase
    ,SUM(CASE WHEN u.bucket = 'Recibidas'   THEN u.cantidad ELSE 0 END) AS Recibidas
    ,SUM(CASE WHEN u.bucket = 'Disponibles' THEN u.cantidad ELSE 0 END) AS Disponibles
    ,SUM(CASE WHEN u.bucket = 'Inspeccion'  THEN u.cantidad ELSE 0 END) AS Inspeccion
    ,SUM(CASE WHEN u.bucket = 'Retrabajo'   THEN u.cantidad ELSE 0 END) AS Retrabajo
    ,COUNT(DISTINCT u.idEtiqueta)                                       AS Etiquetas
    ,COUNT(DISTINCT u.idMaterial)                                       AS Materiales
INTO #nodoWip
FROM (
    -- Disponibles: en transito hacia el nodo destino. Si la etiqueta no matchea
    -- la ruta (dstFase NULL) caemos a fase 1 + planta fisica para no perder WIP.
    SELECT idProcesoSiguiente AS idProceso, COALESCE(dstPlanta, idPlantaEtiq) AS idPlanta, COALESCE(dstFase, 1) AS Fase,
           cantidad, idEtiqueta, idMaterial, CAST('Disponibles' AS varchar(20)) AS bucket
    FROM #ea
    WHERE idEstatusEtiqueta = 2 AND idProcesoSiguiente IS NOT NULL
      AND (procesoUbicacion IS NULL OR procesoUbicacion <> idProcesoSiguiente)
    UNION ALL
    -- Recibidas: fisicamente en el nodo destino
    SELECT idProcesoSiguiente, COALESCE(dstPlanta, idPlantaEtiq), COALESCE(dstFase, 1), cantidad, idEtiqueta, idMaterial, CAST('Recibidas' AS varchar(20))
    FROM #ea
    WHERE idEstatusEtiqueta = 2 AND idProcesoSiguiente IS NOT NULL
      AND procesoUbicacion = idProcesoSiguiente
    UNION ALL
    -- Inspeccion: fisicamente en el nodo fisico (procesoActual)
    SELECT procesoActual, COALESCE(srcPlanta, idPlantaEtiq), COALESCE(srcFase, 1), cantidad, idEtiqueta, idMaterial, CAST('Inspeccion' AS varchar(20))
    FROM #ea
    WHERE idEstatusEtiqueta = 1 AND procesoActual IS NOT NULL
    UNION ALL
    -- Retrabajo: fisicamente en el nodo fisico (procesoActual)
    SELECT procesoActual, COALESCE(srcPlanta, idPlantaEtiq), COALESCE(srcFase, 1), cantidad, idEtiqueta, idMaterial, CAST('Retrabajo' AS varchar(20))
    FROM #ea
    WHERE idEstatusEtiqueta = 5 AND procesoActual IS NOT NULL
) u
GROUP BY u.idProceso, u.idPlanta, u.Fase;

-- (8) WIP por ARISTA (transito X->Y matcheado a una arista de ruta con fase). ---
SELECT
     emProcO   AS idProcOrigen
    ,emPlantaO AS plantaOrigen
    ,emFaseO   AS faseOrigen
    ,emProcD   AS idProcDestino
    ,emPlantaD AS plantaDestino
    ,emFaseD   AS faseDestino
    ,SUM(cantidad)              AS Piezas
    ,COUNT(DISTINCT idEtiqueta) AS Etiquetas
INTO #edgeWip
FROM #ea
WHERE idEstatusEtiqueta = 2
  AND emProcO IS NOT NULL          -- solo etiquetas con transicion matcheada
  AND emProcD IS NOT NULL
  AND (procesoUbicacion IS NULL OR procesoUbicacion <> idProcesoSiguiente)
GROUP BY emProcO, emPlantaO, emFaseO, emProcD, emPlantaD, emFaseD;

-- ===== Result-set (A): BLOQUES = nodos de proceso + nodos-puerta ==============
-- (A1) Nodos de proceso de la planta P (o todos si P es NULL).
;WITH nodosProc AS
(
    SELECT DISTINCT idProceso, idPlanta, Fase FROM #run
    WHERE (@idPlantaFiltro IS NULL OR idPlanta = @idPlantaFiltro)
    UNION   -- nodos huerfanos: proceso con WIP pero sin ruta (como el query previo)
    SELECT DISTINCT idProceso, idPlanta, Fase FROM #nodoWip
    WHERE (@idPlantaFiltro IS NULL OR idPlanta = @idPlantaFiltro)
)
SELECT
     n.idProceso
    ,ISNULL(p.Nombre, '(sin proceso)') AS Proceso
    ,n.idPlanta
    ,pl.Nombre                         AS NombrePlanta
    ,n.Fase                            AS Fase
    ,rg.Rango                          AS Rango
    ,ISNULL(w.Recibidas, 0)            AS Recibidas
    ,ISNULL(w.Disponibles, 0)          AS Disponibles
    ,ISNULL(w.Inspeccion, 0)           AS Inspeccion
    ,ISNULL(w.Retrabajo, 0)            AS Retrabajo
    ,ISNULL(w.Etiquetas, 0)            AS Etiquetas
    ,ISNULL(w.Materiales, 0)           AS Materiales
    ,CAST(0 AS bit)                    AS EsPuerta
    ,CAST(NULL AS int)                 AS idPlantaVecina
    ,CAST(NULL AS nvarchar(128))       AS NombrePlantaVecina
    ,CAST(NULL AS varchar(3))          AS Direccion
FROM nodosProc n
LEFT JOIN #nodoWip w
       ON w.idProceso = n.idProceso AND w.idPlanta = n.idPlanta AND w.Fase = n.Fase
LEFT JOIN #rango rg
       ON rg.idProceso = n.idProceso AND rg.idPlanta = n.idPlanta AND rg.Fase = n.Fase
LEFT JOIN EPS.dbo.tblProceso p  ON p.idProceso = n.idProceso
LEFT JOIN EPS.dbo.tblPlanta  pl ON pl.idPlanta = n.idPlanta

UNION ALL

-- (A2) Nodos-puerta: una por (planta vecina x direccion), solo si hay drill (P).
SELECT
     CAST(NULL AS int)                 AS idProceso
    ,plv.Nombre                        AS Proceso           -- muestra el nombre de la planta
    ,@idPlantaFiltro                   AS idPlanta
    ,plc.Nombre                        AS NombrePlanta
    ,CAST(NULL AS int)                 AS Fase
    ,CASE WHEN g.Direccion = 'in' THEN CAST(-1 AS float)
          ELSE CAST(99999 AS float) END AS Rango           -- entra: extremo izq / sale: extremo der
    ,0 AS Recibidas ,0 AS Disponibles ,0 AS Inspeccion ,0 AS Retrabajo
    ,0 AS Etiquetas ,0 AS Materiales
    ,CAST(1 AS bit)                    AS EsPuerta
    ,g.idPlantaVecina
    ,plv.Nombre                        AS NombrePlantaVecina
    ,g.Direccion
FROM (
    SELECT DISTINCT plantaOrigen AS idPlantaVecina, CAST('in' AS varchar(3)) AS Direccion
    FROM #edge
    WHERE @idPlantaFiltro IS NOT NULL
      AND plantaDestino = @idPlantaFiltro AND plantaOrigen <> @idPlantaFiltro
    UNION
    SELECT DISTINCT plantaDestino, CAST('out' AS varchar(3))
    FROM #edge
    WHERE @idPlantaFiltro IS NOT NULL
      AND plantaOrigen = @idPlantaFiltro AND plantaDestino <> @idPlantaFiltro
) g
LEFT JOIN EPS.dbo.tblPlanta plv ON plv.idPlanta = g.idPlantaVecina
LEFT JOIN EPS.dbo.tblPlanta plc ON plc.idPlanta = @idPlantaFiltro
ORDER BY idPlanta, Rango, idProceso;

-- ===== Result-set (B): ARISTAS = transiciones intra-planta + aristas de puerta =
-- (B1) Aristas intra-planta (ambos extremos en P, o todas si P es NULL).
;WITH aristasIntra AS
(
    SELECT DISTINCT idProcOrigen, plantaOrigen, faseOrigen, idProcDestino, plantaDestino, faseDestino
    FROM #edge
    WHERE idProcDestino IS NOT NULL
      AND (@idPlantaFiltro IS NULL
           OR (plantaOrigen = @idPlantaFiltro AND plantaDestino = @idPlantaFiltro))
)
SELECT
     a.idProcOrigen                     AS idProcesoOrigen
    ,ISNULL(po.Nombre, '(sin proceso)') AS ProcesoOrigen
    ,a.faseOrigen                       AS FaseOrigen
    ,a.idProcDestino                    AS idProcesoDestino
    ,ISNULL(pd.Nombre, '(sin proceso)') AS ProcesoDestino
    ,a.faseDestino                      AS FaseDestino
    ,a.plantaOrigen                     AS idPlanta
    ,ISNULL(w.Piezas, 0)                AS Piezas
    ,ISNULL(w.Etiquetas, 0)             AS Etiquetas
    ,CAST(0 AS bit)                     AS EsInterPlanta
    ,CAST(NULL AS varchar(3))           AS Direccion
    ,CAST(NULL AS int)                  AS idPlantaVecina
    ,CAST(NULL AS nvarchar(128))        AS NombrePlantaVecina
    ,CAST(NULL AS nvarchar(128))        AS ProcesoFrontera
FROM aristasIntra a
LEFT JOIN #edgeWip w
       ON w.idProcOrigen = a.idProcOrigen AND w.plantaOrigen = a.plantaOrigen AND w.faseOrigen = a.faseOrigen
      AND w.idProcDestino = a.idProcDestino AND w.plantaDestino = a.plantaDestino AND w.faseDestino = a.faseDestino
LEFT JOIN EPS.dbo.tblProceso po ON po.idProceso = a.idProcOrigen
LEFT JOIN EPS.dbo.tblProceso pd ON pd.idProceso = a.idProcDestino

UNION ALL

-- (B2) Aristas de puerta ENTRADA: planta vecina -> proceso de P. El nodo origen
--      es la puerta; el destino es un proceso real de P. ProcesoFrontera = el
--      proceso que surte en la otra planta.
SELECT
     a.idProcOrigen                     AS idProcesoOrigen
    ,ISNULL(po.Nombre, '(sin proceso)') AS ProcesoOrigen
    ,a.faseOrigen                       AS FaseOrigen
    ,a.idProcDestino                    AS idProcesoDestino
    ,ISNULL(pd.Nombre, '(sin proceso)') AS ProcesoDestino
    ,a.faseDestino                      AS FaseDestino
    ,@idPlantaFiltro                    AS idPlanta
    ,ISNULL(w.Piezas, 0)                AS Piezas
    ,ISNULL(w.Etiquetas, 0)             AS Etiquetas
    ,CAST(1 AS bit)                     AS EsInterPlanta
    ,CAST('in' AS varchar(3))           AS Direccion
    ,a.plantaOrigen                     AS idPlantaVecina
    ,plv.Nombre                         AS NombrePlantaVecina
    ,ISNULL(po.Nombre, '(sin proceso)') AS ProcesoFrontera
FROM (
    SELECT DISTINCT idProcOrigen, plantaOrigen, faseOrigen, idProcDestino, plantaDestino, faseDestino
    FROM #edge
    WHERE @idPlantaFiltro IS NOT NULL AND idProcDestino IS NOT NULL
      AND plantaDestino = @idPlantaFiltro AND plantaOrigen <> @idPlantaFiltro
) a
LEFT JOIN #edgeWip w
       ON w.idProcOrigen = a.idProcOrigen AND w.plantaOrigen = a.plantaOrigen AND w.faseOrigen = a.faseOrigen
      AND w.idProcDestino = a.idProcDestino AND w.plantaDestino = a.plantaDestino AND w.faseDestino = a.faseDestino
LEFT JOIN EPS.dbo.tblProceso po ON po.idProceso = a.idProcOrigen
LEFT JOIN EPS.dbo.tblProceso pd ON pd.idProceso = a.idProcDestino
LEFT JOIN EPS.dbo.tblPlanta   plv ON plv.idPlanta = a.plantaOrigen

UNION ALL

-- (B3) Aristas de puerta SALIDA: proceso de P -> planta vecina. El nodo destino
--      es la puerta. ProcesoFrontera = el proceso que recibe en la otra planta.
SELECT
     a.idProcOrigen                     AS idProcesoOrigen
    ,ISNULL(po.Nombre, '(sin proceso)') AS ProcesoOrigen
    ,a.faseOrigen                       AS FaseOrigen
    ,a.idProcDestino                    AS idProcesoDestino
    ,ISNULL(pd.Nombre, '(sin proceso)') AS ProcesoDestino
    ,a.faseDestino                      AS FaseDestino
    ,@idPlantaFiltro                    AS idPlanta
    ,ISNULL(w.Piezas, 0)                AS Piezas
    ,ISNULL(w.Etiquetas, 0)             AS Etiquetas
    ,CAST(1 AS bit)                     AS EsInterPlanta
    ,CAST('out' AS varchar(3))          AS Direccion
    ,a.plantaDestino                    AS idPlantaVecina
    ,plv.Nombre                         AS NombrePlantaVecina
    ,ISNULL(pd.Nombre, '(sin proceso)') AS ProcesoFrontera
FROM (
    SELECT DISTINCT idProcOrigen, plantaOrigen, faseOrigen, idProcDestino, plantaDestino, faseDestino
    FROM #edge
    WHERE @idPlantaFiltro IS NOT NULL AND idProcDestino IS NOT NULL
      AND plantaOrigen = @idPlantaFiltro AND plantaDestino <> @idPlantaFiltro
) a
LEFT JOIN #edgeWip w
       ON w.idProcOrigen = a.idProcOrigen AND w.plantaOrigen = a.plantaOrigen AND w.faseOrigen = a.faseOrigen
      AND w.idProcDestino = a.idProcDestino AND w.plantaDestino = a.plantaDestino AND w.faseDestino = a.faseDestino
LEFT JOIN EPS.dbo.tblProceso po ON po.idProceso = a.idProcOrigen
LEFT JOIN EPS.dbo.tblProceso pd ON pd.idProceso = a.idProcDestino
LEFT JOIN EPS.dbo.tblPlanta   plv ON plv.idPlanta = a.plantaDestino
ORDER BY idPlanta, idProcesoOrigen, idProcesoDestino;

DROP TABLE #comp, #raw, #run, #edge, #rango, #etiq, #ea, #nodoWip, #edgeWip;
