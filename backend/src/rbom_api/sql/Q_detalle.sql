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


-- (4) WIP por (componente, proceso) en 5 buckets ------------------------------
--   Disponibles    estatus=LIBERADO, idProcesoSiguiente=X, ubicacion <> X
--                  (espera entrar a X, no llego fisicamente)
--   Recibidas      estatus=LIBERADO, idProcesoSiguiente=X, ubicacion = X
--                  (ya esta fisicamente en X)
--   PorTransferir  estatus=LIBERADO, procesoActual=X, idProcesoSiguiente<>X,
--                  ubicacion <> idProcesoSiguiente
--                  (X la libero pero aun NO ha llegado fisicamente al siguiente
--                   proceso; cuando llega ubic=sig, cuenta como Recibidas del
--                   siguiente y deja de contar como PorTransferir de X.)
--   Inspeccion     estatus=POR INSPECCION (=1), procesoActual=X
--   Retrabajo      estatus=POR RETRABAJO (=5), procesoActual=X
--
--   Piezas = Disponibles + Recibidas (suma compat con el netteo): es el
--   conjunto que aun debe pasar por X y por tanto descuenta req_paso.
--   PorTransferir / Inspeccion / Retrabajo son SOLO display.
--
-- procesoActual = LEFT JOIN a tblEtiquetaProceso(bUltimoProceso=1).idProceso
-- (fuente directa, no inferida de la ruta). Si una etiqueta nunca fue procesada
-- por ningun proceso, procesoActual = NULL y no entra en PT/Insp/Ret.
--
-- Garantia de no-duplicacion:
--   - Validado contra BD que las unicas etiquetas con bUltimoProceso=1
--     duplicada son bActiva=false; el filtro `e.bActiva = 1` las excluye.
--   - Dentro de un mismo (idComp, idProceso), Disponibles y Recibidas son
--     disjuntas por la condicion sobre ubicacion; con PorTransferir solo
--     habria solape si procesoSiguiente = procesoActual = X (loop trivial),
--     descartado por la condicion `procesoActual <> idProcesoSiguiente`.
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
      ,u.idProceso                AS procesoUbicacion
      ,ep.idProceso               AS idProcesoUlt  -- proceso actual (ultimo por el que paso). NULL si nunca paso.
    FROM
      EPS.Produccion.tblEtiqueta e
      LEFT JOIN EPS.Produccion.tblUbicacion u ON e.idUbicacion = u.idUbicacion
      LEFT JOIN EPS.Produccion.tblEtiquetaProceso ep
             ON ep.idEtiqueta = e.idEtiqueta
            AND ep.bUltimoProceso = 1
    WHERE e.bActiva           = 1
      AND e.idTipoEtiqueta    = 3              -- LIBERACION
      AND e.idEstatusEtiqueta IN (1, 2, 5)      -- POR INSPECCION / LIBERADO / POR RETRABAJO
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
    -- Disponibles: estatus=2, sig=X, ubic <> X
    SELECT idComp, idProcesoSiguiente AS idProceso, cantidad,
           1 AS bDisp, 0 AS bRecib, 0 AS bTrans, 0 AS bInsp, 0 AS bRetrab
    FROM cteEtq
    WHERE idEstatusEtiqueta = 2 AND idProcesoSiguiente IS NOT NULL
      AND (procesoUbicacion IS NULL OR procesoUbicacion <> idProcesoSiguiente)

    UNION ALL

    -- Recibidas: estatus=2, sig=X, ubic = X
    SELECT idComp, idProcesoSiguiente, cantidad,
           0, 1, 0, 0, 0
    FROM cteEtq
    WHERE idEstatusEtiqueta = 2 AND idProcesoSiguiente IS NOT NULL
      AND procesoUbicacion = idProcesoSiguiente

    UNION ALL

    -- PorTransferir: estatus=2, procActual=X, sig != X, ubic <> sig
    -- (la etiqueta salio de X pero aun no llego fisicamente al siguiente;
    --  cuando ubic=sig deja de ser "Por transferir" en X y cuenta como
    --  "Recibidas" del siguiente.)
    SELECT idComp, idProcesoUlt, cantidad,
           0, 0, 1, 0, 0
    FROM cteEtq
    WHERE idEstatusEtiqueta = 2
      AND idProcesoUlt IS NOT NULL
      AND idProcesoSiguiente IS NOT NULL
      AND idProcesoUlt <> idProcesoSiguiente
      AND (procesoUbicacion IS NULL OR procesoUbicacion <> idProcesoSiguiente)

    UNION ALL

    -- Inspeccion: estatus=1, procActual=X
    SELECT idComp, idProcesoUlt, cantidad,
           0, 0, 0, 1, 0
    FROM cteEtq
    WHERE idEstatusEtiqueta = 1 AND idProcesoUlt IS NOT NULL

    UNION ALL

    -- Retrabajo: estatus=5, procActual=X
    SELECT idComp, idProcesoUlt, cantidad,
           0, 0, 0, 0, 1
    FROM cteEtq
    WHERE idEstatusEtiqueta = 5 AND idProcesoUlt IS NOT NULL
  )
SELECT
   b.idComp
  ,b.idProceso
  ,ISNULL(p.Nombre, '(sin proceso)')                                           AS Proceso
  -- Compat con netteo: Piezas/Etiquetas = Disponibles + Recibidas
  ,SUM(CASE WHEN b.bDisp = 1 OR b.bRecib = 1 THEN 1 ELSE 0 END)                AS Etiquetas
  ,SUM(CASE WHEN b.bDisp = 1 OR b.bRecib = 1 THEN b.cantidad ELSE 0 END)       AS Piezas
  -- Desglose individual
  ,SUM(CASE WHEN b.bDisp   = 1 THEN 1 ELSE 0 END)                              AS EtiquetasDisponibles
  ,SUM(CASE WHEN b.bDisp   = 1 THEN b.cantidad ELSE 0 END)                     AS PiezasDisponibles
  ,SUM(CASE WHEN b.bRecib  = 1 THEN 1 ELSE 0 END)                              AS EtiquetasRecibidas
  ,SUM(CASE WHEN b.bRecib  = 1 THEN b.cantidad ELSE 0 END)                     AS PiezasRecibidas
  ,SUM(CASE WHEN b.bTrans  = 1 THEN 1 ELSE 0 END)                              AS EtiquetasLiberadas
  ,SUM(CASE WHEN b.bTrans  = 1 THEN b.cantidad ELSE 0 END)                     AS PiezasLiberadas
  ,SUM(CASE WHEN b.bInsp   = 1 THEN 1 ELSE 0 END)                              AS EtiquetasInspeccion
  ,SUM(CASE WHEN b.bInsp   = 1 THEN b.cantidad ELSE 0 END)                     AS PiezasInspeccion
  ,SUM(CASE WHEN b.bRetrab = 1 THEN 1 ELSE 0 END)                              AS EtiquetasRetrabajo
  ,SUM(CASE WHEN b.bRetrab = 1 THEN b.cantidad ELSE 0 END)                     AS PiezasRetrabajo
FROM cteBuckets b
LEFT JOIN EPS.dbo.tblProceso p ON p.idProceso = b.idProceso
GROUP BY b.idComp, b.idProceso, p.Nombre
ORDER BY b.idComp, Piezas DESC;
