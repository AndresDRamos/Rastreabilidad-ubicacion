-- =============================================================================
-- Q_remision_detalle.sql  -  Lineas de remision que componen una celda de
-- embarque del calendario: un (PT x Cliente x Ciudad) dentro de un rango de
-- fechas. Devuelve folio de remision, factura, orden de venta y PO de cada
-- linea, para el popover de detalle. Espejo hacia el pasado de Q_orden_detalle.
--
-- Fuente y puentes: identicos a Q_embarques_calendario.sql (vwRemisiones +
-- mapeo ItemID->idMaterial / Customer_Id->idCliente / City->idCiudad).
--
-- Parametros:
--   @idMaterial int   (requerido)
--
-- Filtros opcionales inyectados como predicados (Python, int/date-validados),
-- sobre el CTE `rem` aliaseado como `d` para reutilizar los mismos predicados
-- que Q_orden_detalle:
--   /*CLIENTE_FILTER*/   AND d.idCliente = <int>
--   /*CIUDAD_FILTER*/    AND d.idCiudad  = <int>
--   /*FECHA_FILTER*/     AND d.Fecha >= '<desde>' AND d.Fecha < '<hasta>'
-- =============================================================================

DECLARE @idMaterial int = @idMaterial;

WITH mapMat AS (
    SELECT DISTINCT d.ItemID, d.idMaterial
    FROM EPS.dbo.tblDemandaEPS d WITH (NOLOCK)
    WHERE d.bActivo = 1
      AND d.idMaterial = @idMaterial
      AND d.ItemID IS NOT NULL
),
cteCliente AS (
    SELECT IdNetSuit, MIN(idCliente) AS idCliente
    FROM EPS.dbo.tblCliente WITH (NOLOCK)
    WHERE IdNetSuit IS NOT NULL
    GROUP BY IdNetSuit
),
cteCiudad AS (
    SELECT UPPER(LTRIM(RTRIM(Ciudad))) AS nombreNorm, MIN(idCiudad) AS idCiudad
    FROM EPS.dbo.tblCiudad WITH (NOLOCK)
    GROUP BY UPPER(LTRIM(RTRIM(Ciudad)))
),
rem AS (
    SELECT
        mm.idMaterial,
        cc.idCliente,
        cci.idCiudad,
        CAST(r.Fecha AS date)              AS Fecha,
        -- Remision/Factura/OrdenVenta vienen numericas desde vwRemisiones; el
        -- modelo (RemisionLinea) las espera como string -> CAST explicito.
        CAST(r.Remision   AS varchar(40))  AS Remision,
        CAST(r.Factura    AS varchar(40))  AS Factura,
        CAST(r.OrdenVenta AS varchar(40))  AS OrdenVenta,
        CAST(r.OrdenCompraLinea AS varchar(80)) AS OrdenCompra,
        r.CantidadRemision                 AS Piezas,
        r.Precio                           AS PrecioUnitario
    FROM EPS.dbo.vwRemisiones r WITH (NOLOCK)
    JOIN mapMat mm ON mm.ItemID = TRY_CONVERT(int, r.Item_Id)
    LEFT JOIN cteCliente cc  ON cc.IdNetSuit  = TRY_CONVERT(int, r.Customer_Id)
    LEFT JOIN cteCiudad  cci ON cci.nombreNorm = UPPER(LTRIM(RTRIM(r.City)))
    WHERE r.CantidadRemision > 0
)
SELECT
    d.Remision,
    d.Factura,
    d.OrdenVenta,
    d.OrdenCompra,
    d.Fecha,
    d.Piezas,
    d.PrecioUnitario
FROM rem d
WHERE 1 = 1
  /*CLIENTE_FILTER*/
  /*CIUDAD_FILTER*/
  /*FECHA_FILTER*/
ORDER BY d.Fecha DESC, d.Remision;
