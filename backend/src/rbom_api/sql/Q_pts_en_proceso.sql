-- =============================================================================
-- Q_pts_en_proceso.sql  -  PTs cuyos componentes tienen WIP asociado al
-- proceso @idProcesoSelected (drill-down de la vista Resumen).
--
-- Devuelve, por PT, las 3 metricas mutuamente excluyentes del bloque X
-- (mismas reglas que Q_bloques.sql):
--
--   Disponibles    estatus=LIBERADO,  sig = X, ubic <> X
--   Recibidas      estatus=LIBERADO,  sig = X, ubic = X
--   PorTransferir  estatus=LIBERADO,  procesoActual = X, sig <> X,
--                  ubicacion <> sig  (no ha llegado fisicamente al siguiente)
--
-- procesoActual viene directo de Produccion.tblEtiquetaProceso con
-- bUltimoProceso = 1 (no se infiere desde la ruta).
--
-- (Inspeccion y Retrabajo NO se desglosan por PT en esta query; solo aparecen
--  en la card del bloque.)
--
-- Tambien devuelve totales:
--   EtiquetasEnProceso     = COUNT DISTINCT de etiquetas que contribuyeron
--   ComponentesEnProceso   = COUNT DISTINCT de idComp que contribuyeron
--
-- Se acota a PTs con demanda activa para no devolver PTs huerfanos sin
-- pedidos pendientes.
--
-- Excluye etiquetas ya remisionadas (mismo criterio que Q_bloques.sql).
--
-- Parametros:
--   @idProcesoSelected int   Obligatorio (es X, el bloque del que dependeran
--                            las metricas).
--   @idCliente         int?  Default NULL (sin filtro de cliente).
--   @idPlantaFiltro    int?  Default NULL (sin filtro de planta).
--
-- Placeholders reemplazados desde Python:
--   /*CIUDADES_FILTER*/  "AND d.idCiudad IN (...)" o "".
--   /*TIPOMAT_FILTER*/   "AND m.idTipoMaterial IN (...)" o "".
--   /*CLASE_FILTER*/     "AND I.CLASS_ID_ARTCULO_ID IN (...)" o "".
-- =============================================================================

DECLARE @idProcesoSelected int = @idProcesoSelected;
DECLARE @idCliente         int = @idCliente;
DECLARE @idPlantaFiltro    int = @idPlantaFiltro;

WITH
    cteDem AS
    (
        SELECT DISTINCT d.idMaterial AS idPT
        FROM EPS.dbo.tblDemandaEPS d
        LEFT JOIN NETSUITE.dbo.ITEMS I ON I.ITEM_ID = d.ItemID
        WHERE d.bActivo = 1
            AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
            AND (@idCliente IS NULL OR d.idCliente = @idCliente)
        /*CIUDADES_FILTER*/
        /*CLASE_FILTER*/
    )
    ,cteBom AS
    (
        SELECT DISTINCT
             b.IdMaterial   AS idPT
            ,b.IdComponent  AS idComp
        FROM EPS.AppProc.tblBomExplosionado b
        JOIN cteDem d ON b.IdMaterial = d.idPT
        WHERE b.IdTipoMaterial IN (1, 3)
    )
    ,cteEtiq AS
    (
        -- Solo etiquetas LIBERADAS (estatus=2). Insp/Retr no entran en el
        -- desglose por PT.
        SELECT
             e.idEtiqueta
            ,e.idMaterial
            ,e.cantidad
            ,e.idProcesoSiguiente
            ,e.idPlantaProceso AS idPlanta
            ,u.idProceso       AS procesoUbicacion
            ,ep.idProceso      AS procesoActual
        FROM EPS.Produccion.tblEtiqueta e
        JOIN EPS.dbo.tblMaterial m ON e.idMaterial = m.idMaterial
        LEFT JOIN EPS.Produccion.tblUbicacion u ON e.idUbicacion = u.idUbicacion
        LEFT JOIN EPS.Produccion.tblEtiquetaProceso ep
               ON ep.idEtiqueta = e.idEtiqueta
              AND ep.bUltimoProceso = 1
        WHERE e.bActiva = 1
            AND e.idTipoEtiqueta    = 3
            AND e.idEstatusEtiqueta = 2
            AND (@idPlantaFiltro IS NULL OR e.idPlantaProceso = @idPlantaFiltro)
            /*TIPOMAT_FILTER*/
            AND NOT EXISTS (
                SELECT 1
                FROM EPS.dbo.vwEtiquetasEnRemision red
                WHERE red.idEtiqueta = e.idEtiqueta
            )
            -- Acota a componentes con demanda activa (universo de cteBom).
            AND EXISTS (
                SELECT 1 FROM cteBom cb WHERE cb.idComp = e.idMaterial
            )
            -- Pre-filtro a los 3 buckets de X: la etiqueta debe entrar a X
            -- o haber salido de X. Reduce significativamente el set sin
            -- necesidad de resolver buckets aqui.
            AND (
                e.idProcesoSiguiente = @idProcesoSelected
                OR ep.idProceso      = @idProcesoSelected
            )
    )
    ,cteContrib AS
    (
        -- Una fila por (idComp, bucket) con cantidad/etiquetas que contribuyen
        -- al bloque X. Mutuamente excluyentes por etiqueta dentro de X.
        SELECT
             e.idMaterial AS idComp
            ,e.idEtiqueta
            ,e.cantidad
            ,CAST('Disponibles' AS varchar(20)) AS bucket
        FROM cteEtiq e
        WHERE e.idProcesoSiguiente = @idProcesoSelected
          AND (e.procesoUbicacion IS NULL OR e.procesoUbicacion <> @idProcesoSelected)

        UNION ALL

        SELECT e.idMaterial, e.idEtiqueta, e.cantidad, CAST('Recibidas' AS varchar(20))
        FROM cteEtiq e
        WHERE e.idProcesoSiguiente = @idProcesoSelected
          AND e.procesoUbicacion = @idProcesoSelected

        UNION ALL

        SELECT e.idMaterial, e.idEtiqueta, e.cantidad, CAST('PorTransferir' AS varchar(20))
        FROM cteEtiq e
        WHERE e.procesoActual = @idProcesoSelected
          AND e.idProcesoSiguiente IS NOT NULL
          AND e.idProcesoSiguiente <> @idProcesoSelected
          AND (e.procesoUbicacion IS NULL OR e.procesoUbicacion <> e.idProcesoSiguiente)
    )
SELECT
     b.idPT
    ,mpt.ClaveMaterial                                                          AS PT
    ,mpt.Descripcion                                                            AS DescripcionPT
    ,COUNT(DISTINCT c.idComp)                                                   AS ComponentesEnProceso
    ,COUNT(DISTINCT c.idEtiqueta)                                               AS EtiquetasEnProceso
    ,SUM(CASE WHEN c.bucket = 'Disponibles'   THEN c.cantidad ELSE 0 END)       AS Disponibles
    ,SUM(CASE WHEN c.bucket = 'Recibidas'     THEN c.cantidad ELSE 0 END)       AS Recibidas
    ,SUM(CASE WHEN c.bucket = 'PorTransferir' THEN c.cantidad ELSE 0 END)       AS PorTransferir
FROM cteBom b
JOIN cteContrib c ON c.idComp = b.idComp
JOIN EPS.dbo.tblMaterial mpt ON b.idPT = mpt.idMaterial
GROUP BY b.idPT, mpt.ClaveMaterial, mpt.Descripcion
HAVING (
    SUM(CASE WHEN c.bucket = 'Disponibles'   THEN c.cantidad ELSE 0 END)
  + SUM(CASE WHEN c.bucket = 'Recibidas'     THEN c.cantidad ELSE 0 END)
  + SUM(CASE WHEN c.bucket = 'PorTransferir' THEN c.cantidad ELSE 0 END)
) > 0
ORDER BY (
    SUM(CASE WHEN c.bucket = 'Disponibles'   THEN c.cantidad ELSE 0 END)
  + SUM(CASE WHEN c.bucket = 'Recibidas'     THEN c.cantidad ELSE 0 END)
  + SUM(CASE WHEN c.bucket = 'PorTransferir' THEN c.cantidad ELSE 0 END)
) DESC;
