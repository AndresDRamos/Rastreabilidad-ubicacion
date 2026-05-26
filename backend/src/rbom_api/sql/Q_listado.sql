-- =============================================================================
-- Q_listado.sql  -  PTs con demanda activa en ventana <= +@ventana_meses
-- Una fila por (PT x Cliente x Ciudad). Past-due INCLUIDO (no se filtra fecha minima).
-- Orden: piezas DESC, fecha promesa ASC (past-due primero dentro de cada nivel).
--
-- Parametros opcionales (NULL = sin filtro):
--   @ventana_meses  int    Default 3
--   @fecha_max      date   Default NULL. Si se provee, recorta el techo a esa fecha
--                          (past-due sigue incluido). El cutoff efectivo es
--                          ISNULL(@fecha_max, @techo).
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
        I.CLASS_ID_ARTCULO_ID                                                   AS idClase,
        C.LIST_ITEM_NAME                                                        AS Clase,
        SUM(d.Cantidad - ISNULL(d.Embarcado, 0))                                AS PiezasPend,
        MIN(CAST(d.Fecha AS date))                                              AS FechaPromMin,
        MAX(CAST(d.Fecha AS date))                                              AS FechaPromMax,
        COUNT(*)                                                                AS Lineas,
        SUM(CASE WHEN d.bForecast = 0 THEN 1 ELSE 0 END)                        AS LineasFirme,
        SUM(CASE WHEN d.bForecast = 1 THEN 1 ELSE 0 END)                        AS LineasForecast,
        SUM(CASE WHEN CAST(d.Fecha AS date) < @hoy
                 THEN (d.Cantidad - ISNULL(d.Embarcado, 0)) ELSE 0 END)         AS PiezasPastDue
    FROM EPS.dbo.tblDemandaEPS d
        LEFT JOIN NETSUITE.dbo.ITEMS    I ON I.ITEM_ID = d.ItemID
        LEFT JOIN NETSUITE.dbo.CLASS_ID C ON C.LIST_ID = I.CLASS_ID_ARTCULO_ID
    WHERE d.bActivo = 1
      AND d.Fecha   <= @cutoff                         -- past-due incluido (sin piso)
      AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
    GROUP BY d.idMaterial, d.idCliente, d.idCiudad, I.CLASS_ID_ARTCULO_ID, C.LIST_ITEM_NAME
)
SELECT
    d.idMaterial,
    m.ClaveMaterial                                AS PT,
    m.Descripcion,
    d.idCliente,
    ISNULL(c.NombreCliente, '(sin cliente)')       AS Cliente,
    d.idCiudad,
    ISNULL(ci.Ciudad, '(sin ciudad)')              AS Ciudad,
    d.idClase,
    d.Clase,
    d.PiezasPend,
    d.PiezasPastDue,
    d.FechaPromMin,
    d.FechaPromMax,
    DATEDIFF(DAY, d.FechaPromMin, @hoy)            AS DiasAtrasoMax,   -- + = past-due
    d.Lineas, d.LineasFirme, d.LineasForecast
FROM cteDem d
JOIN EPS.dbo.tblMaterial m  ON d.idMaterial = m.idMaterial
LEFT JOIN EPS.dbo.tblCliente c  ON d.idCliente = c.idCliente
LEFT JOIN EPS.dbo.tblCiudad  ci ON d.idCiudad  = ci.idCiudad
ORDER BY d.PiezasPend DESC, d.FechaPromMin ASC;
