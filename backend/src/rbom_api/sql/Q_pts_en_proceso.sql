-- =============================================================================
-- Q_pts_en_proceso.sql  -  PTs cuyos componentes tienen WIP activo esperando
-- entrar al proceso @idProcesoSelected.
--
-- Se acota a PTs con demanda activa para no devolver PTs huerfanos sin
-- pedidos pendientes.
--
-- Excluye etiquetas ya remisionadas (mismo criterio que Q_bloques.sql).
--
-- Parametros:
--   @idProcesoSelected int   Obligatorio
--   @idCliente         int?  Default NULL (sin filtro de cliente)
--   @idPlantaFiltro    int?  Default NULL (sin filtro de planta)
-- =============================================================================

DECLARE @idProcesoSelected int = @idProcesoSelected;
DECLARE @idCliente         int = @idCliente;
DECLARE @idPlantaFiltro    int = @idPlantaFiltro;

WITH cteDem AS (
    SELECT DISTINCT d.idMaterial AS idPT
    FROM EPS.dbo.tblDemandaEPS d
    WHERE d.bActivo = 1
      AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
      AND (@idCliente IS NULL OR d.idCliente = @idCliente)
      /*CIUDADES_FILTER*/
),
cteBom AS (
    SELECT DISTINCT b.IdMaterial AS idPT, b.IdComponent AS idComp
    FROM EPS.AppProc.tblBomExplosionado b
    JOIN cteDem d ON b.IdMaterial = d.idPT
    WHERE b.IdTipoMaterial IN (1, 3)
),
cteWIPenProceso AS (
    SELECT
        e.idMaterial      AS idComp,
        e.idPlantaProceso AS idPlanta,
        SUM(e.cantidad)   AS Piezas,
        COUNT(*)          AS Etiquetas
    FROM EPS.Produccion.tblEtiqueta e
    WHERE e.bActiva            = 1
      AND e.idEstatusEtiqueta  = 2
      AND e.idTipoEtiqueta     = 3
      AND e.idProcesoSiguiente = @idProcesoSelected
      AND NOT EXISTS (
            SELECT 1
            FROM EPS.Produccion.tblRemisionEtiquetaDetalle red
            WHERE red.idEtiqueta = e.idEtiqueta
      )
    GROUP BY e.idMaterial, e.idPlantaProceso
)
SELECT
    b.idPT,
    mpt.ClaveMaterial                       AS PT,
    mpt.Descripcion                         AS DescripcionPT,
    COUNT(DISTINCT w.idComp)                AS ComponentesEnProceso,
    SUM(w.Piezas)                           AS PiezasEnProceso,
    SUM(w.Etiquetas)                        AS EtiquetasEnProceso
FROM cteBom b
JOIN cteWIPenProceso w   ON b.idComp = w.idComp
JOIN EPS.dbo.tblMaterial mpt ON b.idPT = mpt.idMaterial
WHERE (@idPlantaFiltro IS NULL OR w.idPlanta = @idPlantaFiltro)
GROUP BY b.idPT, mpt.ClaveMaterial, mpt.Descripcion
ORDER BY PiezasEnProceso DESC;
