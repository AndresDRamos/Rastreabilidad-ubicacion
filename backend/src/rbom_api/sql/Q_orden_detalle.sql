-- =============================================================================
-- Q_orden_detalle.sql  -  Lineas de demanda que componen una celda del
-- calendario de requerimiento: un (PT x Cliente x Ciudad) dentro de un rango de
-- fechas. Devuelve la orden de venta y el PO de cada linea, para el popover de
-- detalle. PiezasPend = Cantidad - Embarcado (pendiente por linea).
--
-- Parametros:
--   @idMaterial int   (requerido)
--
-- Filtros opcionales inyectados como predicados (Python, int/date-validados):
--   /*CLIENTE_FILTER*/   AND d.idCliente = <int>
--   /*CIUDAD_FILTER*/    AND d.idCiudad  = <int>
--   /*FECHA_FILTER*/     AND d.Fecha >= '<desde>' AND d.Fecha < '<hasta>'
--   /*FORECAST_FILTER*/  AND d.bForecast = 0   (cuando NO se incluye forecast)
-- =============================================================================

DECLARE @idMaterial int = @idMaterial;

SELECT
    d.OrdenVenta,
    d.POHeader,
    d.POLine,
    CAST(d.Fecha AS date)                        AS Fecha,
    d.bForecast,
    (d.Cantidad - ISNULL(d.Embarcado, 0))        AS PiezasPend,
    d.Precio_Unitario                            AS PrecioUnitario
FROM EPS.dbo.tblDemandaEPS d
WHERE d.bActivo = 1
  AND d.idMaterial = @idMaterial
  AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
  /*CLIENTE_FILTER*/
  /*CIUDAD_FILTER*/
  /*FECHA_FILTER*/
  /*FORECAST_FILTER*/
ORDER BY d.Fecha, d.OrdenVenta;
