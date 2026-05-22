-- =============================================================================
-- Q_detalle.sql  -  4 result-sets para armar el arbol BOM + Rutas + WIP de 1 PT
--
-- Parametros:
--   @idPT           int    PT raiz a explosionar
--   @ventana_meses  int    Default 3 (techo de demanda, past-due incluido)
--
-- Result-sets:
--   (1) DEMANDA     - una fila por (PT, Cliente, Ciudad) con piezas pendientes
--   (2) BOM         - arbol multinivel (PT + Intermedios, filtra MP/Dibujos)
--   (3) RUTA        - secuencia de procesos por componente
--   (4) WIP         - WIP activo por (componente, idProcesoSiguiente)
-- =============================================================================

DECLARE @ventana_meses int = ISNULL(@ventana_meses, 3);
DECLARE @hoy           date = CAST(GETDATE() AS date);
DECLARE @techo         date = DATEADD(MONTH, @ventana_meses, @hoy);


-- (1) DEMANDA del PT en la ventana, agrupada por (Cliente, Ciudad) -------------
SELECT
  d.idMaterial
  ,m.ClaveMaterial                                    AS PT
  ,m.Descripcion
  ,d.idCliente
  ,ISNULL(c.NombreCliente, '(sin cliente)')           AS Cliente
  ,d.idCiudad
  ,ISNULL(ci.Ciudad, '(sin ciudad)')                  AS Ciudad
  ,SUM(d.Cantidad - ISNULL(d.Embarcado, 0))           AS PiezasPend
  ,MIN(CAST(d.Fecha AS date))                         AS FechaPromMin
  ,MAX(CAST(d.Fecha AS date))                         AS FechaPromMax
  ,SUM(CASE WHEN CAST(d.Fecha AS date) < @hoy
                THEN (d.Cantidad - ISNULL(d.Embarcado, 0)) ELSE 0 END) AS PiezasPastDue
FROM
  EPS.dbo.tblDemandaEPS d
  JOIN EPS.dbo.tblMaterial m  ON d.idMaterial = m.idMaterial
  LEFT JOIN EPS.dbo.tblCliente c  ON d.idCliente = c.idCliente
  LEFT JOIN EPS.dbo.tblCiudad  ci ON d.idCiudad  = ci.idCiudad
WHERE d.bActivo    = 1
  AND d.idMaterial = @idPT
  AND d.Fecha      <= @techo
  AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
GROUP BY d.idMaterial, m.ClaveMaterial, m.Descripcion,
         d.idCliente, c.NombreCliente, d.idCiudad, ci.Ciudad
ORDER BY PiezasPend DESC;


-- (2) BOM multinivel (PT + Intermedios solamente) ------------------------------
SELECT
  b.IdBom
  ,b.IdBomParent
  ,b.BomLevel
  ,b.IdComponent                                AS idComp
  ,mc.ClaveMaterial                            AS Componente
  ,mc.Descripcion                              AS DescripcionComp
  ,b.IdPadre
  ,mp.ClaveMaterial                            AS ClavePadre
  ,b.IdTipoMaterial                            AS idTipoMat
  ,tm.Descripcion                              AS TipoMaterial
  ,b.CantidadEnsamble
  ,b.Hijos                                     AS HijosTotales
  ,b.bLastLevel
  ,b.idPlanta
  ,b.PrimerIdProceso
  ,pp.Nombre                AS PrimerProceso
  ,b.UltimoIdProceso
  ,pu.Nombre                AS UltimoProceso
FROM
  EPS.AppProc.tblBomExplosionado b
  JOIN EPS.dbo.tblMaterial mc ON b.IdComponent = mc.idMaterial
  LEFT JOIN EPS.dbo.tblMaterial mp ON b.IdPadre = mp.idMaterial
  LEFT JOIN EPS.dbo.tblTipoMaterial tm ON b.IdTipoMaterial = tm.idTipoMaterial
  LEFT JOIN EPS.dbo.tblProceso pp ON b.PrimerIdProceso = pp.idProceso
  LEFT JOIN EPS.dbo.tblProceso pu ON b.UltimoIdProceso = pu.idProceso
WHERE b.IdMaterial   = @idPT
  AND b.IdTipoMaterial IN (1, 3)
-- PT + Intermedios; excluye MP/Dibujos/Herramental/Indirectos
ORDER BY b.BomLevel, b.IdBom;


-- (3) RUTAS por componente (todos los PT/Intermedios del arbol) -----------------
WITH
  cteCompArbol
  AS
  (
    SELECT
      DISTINCT
      b.IdComponent
    FROM
      EPS.AppProc.tblBomExplosionado b
    WHERE b.IdMaterial = @idPT
      AND b.IdTipoMaterial IN (1, 3)
  )
SELECT
  mrt.idMaterial                              AS idComp
  ,mrt.OrdenFabricacion                        AS OrdenRuta
  ,mrt.idRuta
  ,r.Nombre                                    AS Ruta
  ,p.idProceso
  ,p.Nombre                                    AS Proceso
  ,p.OrdenProceso
  ,mrt.IdPlanta
  ,mrt.TiempoProceso
  ,LEAD(p.idProceso) OVER (PARTITION BY mrt.idMaterial ORDER BY mrt.OrdenFabricacion) AS idProcesoSiguiente
  ,LEAD(p.Nombre)    OVER (PARTITION BY mrt.idMaterial ORDER BY mrt.OrdenFabricacion) AS ProcesoSiguiente
FROM
  EPS.dbo.tblMaterialRutaTiempo mrt
  JOIN EPS.dbo.tblRuta r ON mrt.idRuta = r.idRuta
  JOIN EPS.dbo.tblProceso p ON r.idProceso = p.idProceso
WHERE mrt.idMaterial IN (SELECT
  IdComponent
FROM
  cteCompArbol)
ORDER BY mrt.idMaterial, mrt.OrdenFabricacion;


-- (4) WIP por componente, posicionado por idProcesoSiguiente -------------------
WITH
  cteCompArbol
  AS
  (
    SELECT
      DISTINCT
      b.IdComponent
    FROM
      EPS.AppProc.tblBomExplosionado b
    WHERE b.IdMaterial = @idPT
      AND b.IdTipoMaterial IN (1, 3)
  )
SELECT
  e.idMaterial                                AS idComp
  ,e.idProcesoSiguiente
  ,ISNULL(p.Nombre, '(sin proceso)')           AS ProcesoSiguiente
  ,COUNT(*)                                    AS Etiquetas
  ,SUM(e.cantidad)                             AS Piezas
FROM
  EPS.Produccion.tblEtiqueta e
  LEFT JOIN EPS.dbo.tblProceso p ON e.idProcesoSiguiente = p.idProceso
WHERE e.bActiva           = 1
  AND e.idEstatusEtiqueta = 2 -- LIBERADO
  AND e.idTipoEtiqueta    = 3 -- LIBERACION
  AND e.idMaterial IN (SELECT
    IdComponent
  FROM
    cteCompArbol)
GROUP BY e.idMaterial, e.idProcesoSiguiente, p.Nombre
ORDER BY e.idMaterial, Piezas DESC;
