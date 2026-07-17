-- =============================================================================
-- Q_requerimiento_calendario.sql  -  Demanda activa DESAGREGADA por fecha.
-- Una fila por (PT x Cliente x Ciudad x Fecha[dia] x bForecast).
--
-- A diferencia de Q_listado.sql (que colapsa a MIN/MAX + total), aqui NO se
-- colapsa la fecha: cada fila es un dia de promesa de embarque. El frontend
-- bucketiza a dia/semana/mes SIN re-consultar. Past-due INCLUIDO (Fecha < hoy,
-- sin piso). PiezasPend = SUM(Cantidad - Embarcado) (ya descuenta lo embarcado).
--
-- El grano es (PT x Cliente x Ciudad) igual que Q_listado: un mismo PT puede
-- aparecer en varias filas si lo demandan varios (cliente x ciudad).
--
-- Parametros opcionales (NULL = sin filtro):
--   @ventana_meses  int    Default 3
--   @fecha_max      date   Default NULL. Recorta el techo a esa fecha (past-due
--                          sigue incluido). Cutoff efectivo = ISNULL(@fecha_max, @techo).
-- =============================================================================

DECLARE @ventana_meses int = ISNULL(@ventana_meses, 3);
DECLARE @fecha_max     date = @fecha_max;          -- NULL = sin filtro extra
DECLARE @hoy           date = CAST(GETDATE() AS date);
DECLARE @techo         date = DATEADD(MONTH, @ventana_meses, @hoy);
DECLARE @cutoff        date = ISNULL(@fecha_max, @techo);

WITH cteDem AS (
    SELECT
        d.idMaterial,
        d.idCliente,
        d.idCiudad,
        CAST(d.Fecha AS date)                            AS Fecha,
        d.bForecast,
        SUM(d.Cantidad - ISNULL(d.Embarcado, 0))         AS PiezasPend
    FROM EPS.dbo.tblDemandaEPS d
    WHERE d.bActivo = 1
      AND d.Fecha   <= @cutoff                           -- past-due incluido (sin piso)
      AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
      /*PT_UNIVERSO_FILTER*/
    GROUP BY d.idMaterial, d.idCliente, d.idCiudad, CAST(d.Fecha AS date), d.bForecast
)
SELECT
    d.idMaterial,
    m.ClaveMaterial                                AS PT,
    m.Descripcion,
    d.idCliente,
    ISNULL(c.NombreCliente, '(sin cliente)')       AS Cliente,
    d.idCiudad,
    ISNULL(ci.Ciudad, '(sin ciudad)')              AS Ciudad,
    d.Fecha,
    d.bForecast,
    d.PiezasPend
FROM cteDem d
JOIN EPS.dbo.tblMaterial m  ON d.idMaterial = m.idMaterial
LEFT JOIN EPS.dbo.tblCliente c  ON d.idCliente = c.idCliente
LEFT JOIN EPS.dbo.tblCiudad  ci ON d.idCiudad  = ci.idCiudad
ORDER BY d.idMaterial, d.Fecha;
