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
--
-- Doctrina ezi-data-core (docs/fuentes/demanda.md):
--   * La clase NetSuit se toma de EPS.dbo.vwClassIDMaterial, que esta al grano
--     (idMaterial, idCliente, idCiudad) — el mismo material tiene clase distinta
--     por cliente/ciudad. NO se toma de NETSUITE.dbo.ITEMS (clase global del
--     item), que clasifica mal las combinaciones donde el cliente la reasigna.
--     La vista puede traer >1 fila por las 3 llaves, asi que se dedupea con
--     ROW_NUMBER antes de unir.
--   * tblDemandaEPS.idMaterial admite 0 y NULL: son lineas de demanda REALES sin
--     material catalogado. Un INNER JOIN a tblMaterial las escondia en silencio
--     (medido 2026-08-03: 27 lineas / 1,692 pzs de 7 clientes). Se etiquetan con
--     bSinMaterial = 1 y siguen contando.
-- =============================================================================

DECLARE @ventana_meses int = ISNULL(@ventana_meses, 3);
DECLARE @fecha_max     date = @fecha_max;          -- NULL = sin filtro extra
DECLARE @hoy           date = CAST(GETDATE() AS date);
DECLARE @techo         date = DATEADD(MONTH, @ventana_meses, @hoy);
DECLARE @cutoff        date = ISNULL(@fecha_max, @techo);

WITH cteClase AS (
    -- Clase NetSuit vigente al grano (material x cliente x ciudad), dedupeada.
    SELECT idMaterial, idCliente, idCiudad, CLASS_ID_ARTCULO_ID, LIST_ITEM_NAME
    FROM (
        SELECT idMaterial, idCliente, idCiudad, CLASS_ID_ARTCULO_ID, LIST_ITEM_NAME,
               ROW_NUMBER() OVER (PARTITION BY idMaterial, idCliente, idCiudad
                                  ORDER BY CLASS_ID_ARTCULO_ID DESC, ITEM_ID DESC) AS rn
        FROM EPS.dbo.vwClassIDMaterial
    ) x
    WHERE rn = 1
),
cteDem AS (
    SELECT
        ISNULL(d.idMaterial, 0)                                                 AS idMaterial,
        d.idCliente,
        d.idCiudad,
        I.CLASS_ID_ARTCULO_ID                                                   AS idClase,
        I.LIST_ITEM_NAME                                                        AS Clase,
        SUM(d.Cantidad - ISNULL(d.Embarcado, 0))                                AS PiezasPend,
        MIN(CAST(d.Fecha AS date))                                              AS FechaPromMin,
        MAX(CAST(d.Fecha AS date))                                              AS FechaPromMax,
        COUNT(*)                                                                AS Lineas,
        SUM(CASE WHEN d.bForecast = 0 THEN 1 ELSE 0 END)                        AS LineasFirme,
        SUM(CASE WHEN d.bForecast = 1 THEN 1 ELSE 0 END)                        AS LineasForecast,
        SUM(CASE WHEN CAST(d.Fecha AS date) < @hoy
                 THEN (d.Cantidad - ISNULL(d.Embarcado, 0)) ELSE 0 END)         AS PiezasPastDue
    FROM EPS.dbo.tblDemandaEPS d
        LEFT JOIN cteClase I ON I.idMaterial = d.idMaterial
                            AND I.idCliente  = d.idCliente
                            AND I.idCiudad   = d.idCiudad
    WHERE d.bActivo = 1
      AND d.Fecha   <= @cutoff                         -- past-due incluido (sin piso)
      AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
      /*PT_UNIVERSO_FILTER*/
    GROUP BY ISNULL(d.idMaterial, 0), d.idCliente, d.idCiudad,
             I.CLASS_ID_ARTCULO_ID, I.LIST_ITEM_NAME
)
SELECT
    d.idMaterial,
    ISNULL(m.ClaveMaterial, '(sin material en EPS)')  AS PT,
    ISNULL(m.Descripcion, 'Linea de demanda sin material catalogado en EPS')
                                                      AS Descripcion,
    CAST(CASE WHEN m.idMaterial IS NULL THEN 1 ELSE 0 END AS bit) AS bSinMaterial,
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
LEFT JOIN EPS.dbo.tblMaterial m ON d.idMaterial = m.idMaterial
LEFT JOIN EPS.dbo.tblCliente c  ON d.idCliente = c.idCliente
LEFT JOIN EPS.dbo.tblCiudad  ci ON d.idCiudad  = ci.idCiudad
ORDER BY d.PiezasPend DESC, d.FechaPromMin ASC;
