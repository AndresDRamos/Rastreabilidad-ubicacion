-- =============================================================================
-- Q_embarques_calendario.sql  -  Historial de EMBARQUES desagregado por fecha.
-- Una fila por (PT x Cliente x Ciudad x Fecha[dia]).
--
-- Es el espejo hacia el PASADO de Q_requerimiento_calendario.sql: donde aquel
-- desagrega la demanda futura por fecha de promesa, este desagrega lo ya
-- remisionado por fecha de embarque. El frontend bucketiza a dia/semana/mes SIN
-- re-consultar y lo pinta como columnas a la IZQUIERDA de la columna Past-due.
--
-- Fuente: EPS.dbo.vwRemisiones (una fila por linea remisionada, cubre 2019-2026;
-- trae piezas ya resueltas en CantidadRemision). Ver la receta de embarques en
-- el proyecto Consultor EPS (fuentes/embarques.md).
--
-- Puentes NetSuite -> EPS (vwRemisiones viene con IDs de NetSuite):
--   * Material: Item_Id -> idMaterial. El mapa vive en tblDemandaEPS activa
--     (idMaterial <-> ItemID es unico, 0 colisiones validadas). Esto acota los
--     embarques al MISMO universo de la demanda activa que alimenta el
--     calendario de requerimiento -> las filas cuadran 1:1 por (PT,Cliente,Ciudad).
--   * Cliente: Customer_Id -> tblCliente.IdNetSuit (matchea 100% en la ventana).
--   * Ciudad: City -> tblCiudad por nombre normalizado (UPPER+TRIM). Best-effort:
--     City de NetSuite es sucio (variantes que UPPER/TRIM no colapsa, ~2%); las
--     lineas sin match caen en idCiudad NULL -> fila "(sin ciudad)".
--
-- cteCliente/cteCiudad colapsan el catalogo a 1 id por IdNetSuit / nombre para
-- que un catalogo con duplicados (mismo IdNetSuit o mismo nombre en 2 filas) NO
-- multiplique la cantidad remisionada.
--
-- Parametros:
--   @meses_atras  int   Default 12. Piso del historico = hoy - @meses_atras.
--
-- Placeholders reemplazados desde Python (igual que Q_requerimiento_calendario):
--   /*PT_UNIVERSO_FILTER*/  "AND d.idMaterial IN (...)" o ""  (Caterpillar CSV).
-- =============================================================================

DECLARE @meses_atras int = ISNULL(@meses_atras, 12);
DECLARE @hoy         date = CAST(GETDATE() AS date);
DECLARE @piso        date = DATEADD(MONTH, -@meses_atras, @hoy);

WITH mapMat AS (
    -- ItemID -> idMaterial, restringido al universo de la demanda activa.
    SELECT DISTINCT d.ItemID, d.idMaterial
    FROM EPS.dbo.tblDemandaEPS d WITH (NOLOCK)
    WHERE d.bActivo = 1
      AND d.idMaterial IS NOT NULL
      AND d.ItemID    IS NOT NULL
      /*PT_UNIVERSO_FILTER*/
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
        CAST(r.Fecha AS date)  AS Fecha,
        r.CantidadRemision     AS Piezas
    FROM EPS.dbo.vwRemisiones r WITH (NOLOCK)
    JOIN mapMat mm ON mm.ItemID = TRY_CONVERT(int, r.Item_Id)
    LEFT JOIN cteCliente cc  ON cc.IdNetSuit  = TRY_CONVERT(int, r.Customer_Id)
    LEFT JOIN cteCiudad  cci ON cci.nombreNorm = UPPER(LTRIM(RTRIM(r.City)))
    WHERE r.Fecha >= @piso
      AND r.Fecha <= @hoy
      AND r.CantidadRemision > 0
)
SELECT
    rem.idMaterial,
    m.ClaveMaterial                            AS PT,
    m.Descripcion,
    rem.idCliente,
    ISNULL(c.NombreCliente, '(sin cliente)')   AS Cliente,
    rem.idCiudad,
    ISNULL(ci.Ciudad, '(sin ciudad)')          AS Ciudad,
    rem.Fecha,
    SUM(rem.Piezas)                            AS PiezasEmbarcadas
FROM rem
JOIN EPS.dbo.tblMaterial m  WITH (NOLOCK) ON rem.idMaterial = m.idMaterial
LEFT JOIN EPS.dbo.tblCliente c  WITH (NOLOCK) ON rem.idCliente = c.idCliente
LEFT JOIN EPS.dbo.tblCiudad  ci WITH (NOLOCK) ON rem.idCiudad  = ci.idCiudad
GROUP BY rem.idMaterial, m.ClaveMaterial, m.Descripcion,
         rem.idCliente, c.NombreCliente, rem.idCiudad, ci.Ciudad, rem.Fecha
ORDER BY rem.idMaterial, rem.Fecha;
