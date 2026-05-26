-- =============================================================================
-- Q_detalle.sql  -  4 result-sets para armar el arbol BOM + Rutas + WIP de 1 PT
--
-- Parametros:
--   @idPT           int    PT raiz a explosionar
--   @ventana_meses  int    Default 3 (techo de demanda, past-due incluido)
--   @fecha_max      date   Opcional. Si se provee, recorta el techo a esa fecha
--                          (past-due sigue incluido). El cutoff efectivo es
--                          ISNULL(@fecha_max, @techo). Espejo de Q_listado.sql.
--
-- Result-sets:
--   (1) DEMANDA     - una fila por (PT, Cliente, Ciudad) con piezas pendientes
--   (2) BOM         - arbol multinivel (PT + Intermedios, filtra MP/Dibujos)
--   (3) RUTA        - secuencia de procesos por componente
--   (4) WIP         - WIP activo por (componente, idProcesoSiguiente)
-- =============================================================================

DECLARE @ventana_meses int = ISNULL(@ventana_meses, 3);
DECLARE @fecha_max     date = @fecha_max;          -- NULL = sin filtro extra
DECLARE @hoy           date = CAST(GETDATE() AS date);
DECLARE @techo         date = DATEADD(MONTH, @ventana_meses, @hoy);
DECLARE @cutoff        date = ISNULL(@fecha_max, @techo);


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
  JOIN EPS.dbo.tblMaterial m ON d.idMaterial = m.idMaterial
  LEFT JOIN EPS.dbo.tblCliente c ON d.idCliente = c.idCliente
  LEFT JOIN EPS.dbo.tblCiudad  ci ON d.idCiudad  = ci.idCiudad
WHERE d.bActivo    = 1
  AND d.idMaterial = @idPT
  AND d.Fecha      <= @cutoff
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


-- (4) WIP por (componente, proceso) en 3 buckets ------------------------------
--   Por procesar = idProcesoSiguiente = idProceso ∧ estatus = LIBERADO (=2)
--                  Mismas piezas que el CTE anterior; alimenta el netteo.
--   Liberadas    = bUltimoProceso(idProceso) ∧ estatus = LIBERADO (=2)
--                  Piezas que YA salieron de este proceso (buffer hacia el sig).
--   En Inspección= bUltimoProceso(idProceso) ∧ estatus = POR INSPECCION (=1)
--                  Piezas que pasaron por este proceso pero aún están en QC.
--
-- Garantía de no-duplicación:
--   - LEFT JOIN a tblEtiquetaProceso con bUltimoProceso=1: validado contra BD
--     que las únicas etiquetas con esa flag duplicada son bActiva=false; el
--     filtro `e.bActiva = 1` las excluye.
--   - UNION ALL puede repetir una etiqueta en dos buckets distintos, pero NO
--     en el mismo (idComp, idProceso): si idProcesoSiguiente=X entonces el
--     último proceso histórico ≠ X.
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
  ),
  cteEtq
  AS
  (
    -- Universo de etiquetas filtradas UNA sola vez
    SELECT
      e.idEtiqueta
      ,e.idMaterial               AS idComp
      ,e.idProcesoSiguiente
      ,e.idEstatusEtiqueta
      ,e.cantidad
      ,ep.idProceso               AS idProcesoUlt  -- último proceso histórico (NULL si no tiene)
    FROM
      EPS.Produccion.tblEtiqueta e
      LEFT JOIN EPS.Produccion.tblEtiquetaProceso ep
             ON ep.idEtiqueta = e.idEtiqueta
            AND ep.bUltimoProceso = 1
    WHERE e.bActiva           = 1
      AND e.idTipoEtiqueta    = 3              -- LIBERACION
      AND e.idEstatusEtiqueta IN (1, 2)        -- POR INSPECCION + LIBERADO
      AND e.idMaterial IN (SELECT IdComponent FROM cteCompArbol)
      AND NOT EXISTS (
            SELECT 1
            FROM EPS.dbo.vwEtiquetasEnRemision red
            WHERE red.idEtiqueta = e.idEtiqueta
          )
  ),
  cteBuckets
  AS
  (
    SELECT idComp, idProcesoSiguiente AS idProceso, cantidad,
           1 AS bPorProcesar, 0 AS bLiberadas, 0 AS bInspeccion
    FROM cteEtq
    WHERE idEstatusEtiqueta = 2 AND idProcesoSiguiente IS NOT NULL
    UNION ALL
    SELECT idComp, idProcesoUlt, cantidad, 0, 1, 0
    FROM cteEtq
    WHERE idEstatusEtiqueta = 2 AND idProcesoUlt IS NOT NULL
    UNION ALL
    SELECT idComp, idProcesoUlt, cantidad, 0, 0, 1
    FROM cteEtq
    WHERE idEstatusEtiqueta = 1 AND idProcesoUlt IS NOT NULL
  )
SELECT
  b.idComp
  ,b.idProceso
  ,ISNULL(p.Nombre, '(sin proceso)')                              AS Proceso
  ,SUM(CASE WHEN b.bPorProcesar = 1 THEN 1 ELSE 0 END)            AS Etiquetas
  ,SUM(CASE WHEN b.bPorProcesar = 1 THEN b.cantidad ELSE 0 END)   AS Piezas
  ,SUM(CASE WHEN b.bLiberadas   = 1 THEN 1 ELSE 0 END)            AS EtiquetasLiberadas
  ,SUM(CASE WHEN b.bLiberadas   = 1 THEN b.cantidad ELSE 0 END)   AS PiezasLiberadas
  ,SUM(CASE WHEN b.bInspeccion  = 1 THEN 1 ELSE 0 END)            AS EtiquetasInspeccion
  ,SUM(CASE WHEN b.bInspeccion  = 1 THEN b.cantidad ELSE 0 END)   AS PiezasInspeccion
FROM cteBuckets b
LEFT JOIN EPS.dbo.tblProceso p ON p.idProceso = b.idProceso
GROUP BY b.idComp, b.idProceso, p.Nombre
ORDER BY b.idComp, Piezas DESC;
