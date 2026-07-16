-- =============================================================================
-- Q_universo_req.sql  -  Insumos para el netteo CROSS-PT de TODO el universo
--                        de demanda activa (bosque completo, no un solo arbol).
--
-- Responde: "¿cuanto se requiere realmente de este componente sumando TODOS los
-- PTs que lo demandan?". Q_detalle.sql solo ve un @idPT; este ve el bosque.
--
-- Parametros:
--   @ventana_meses  int    Default 3 (techo de demanda, past-due incluido)
--   @fecha_max      date   Opcional. Recorta el techo. ISNULL(@fecha_max, @techo).
--
-- Result-sets:
--   (1) DEMANDA      - una fila por PT raiz con demanda activa (ya agregada)
--   (2) ARISTAS      - grafo padre->hijo DEDUPLICADO a nivel universo
--   (3) WIP          - piezas por componente (bucket "por procesar")
--   (4) PTS_POR_COMP - que PTs demandan cada componente (para la leyenda de UI)
--
-- NOTA DE VOLUMEN (medido contra BD real 2026-07): ~2,433 PTs, ~7,157 filas de
-- BOM, ~6,113 componentes, ~19.7K filas de ruta, ~7.8K filas de WIP. Las 3
-- queries pesadas corren en ~0.8 s en conjunto, asi que el universo completo se
-- resuelve en un request y se cachea con TTL — no hace falta vista
-- materializada ni job en background.
--
-- Este query NO trae rutas: el netteo cross-PT solo necesita la pasada 1
-- (req_bruto / req_neto por componente). La pasada 2 (req_paso por proceso)
-- sigue viviendo en Q_detalle.sql, por arbol.
-- =============================================================================

DECLARE @ventana_meses int = ISNULL(@ventana_meses, 3);
DECLARE @fecha_max     date = @fecha_max;          -- NULL = sin filtro extra
DECLARE @hoy           date = CAST(GETDATE() AS date);
DECLARE @techo         date = DATEADD(MONTH, @ventana_meses, @hoy);
DECLARE @cutoff        date = ISNULL(@fecha_max, @techo);


-- (1) DEMANDA agregada por PT raiz ---------------------------------------------
-- Sin desglose por cliente/ciudad: para el netteo cross-PT solo importa el
-- total por PT. Past-due incluido (sin piso de fecha).
SELECT
   d.idMaterial
  ,m.ClaveMaterial                              AS PT
  ,SUM(d.Cantidad - ISNULL(d.Embarcado, 0))     AS PiezasPend
FROM
  EPS.dbo.tblDemandaEPS d
  JOIN EPS.dbo.tblMaterial m ON d.idMaterial = m.idMaterial
WHERE d.bActivo = 1
  AND d.Fecha  <= @cutoff
  AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
GROUP BY d.idMaterial, m.ClaveMaterial;


-- (2) ARISTAS del bosque, en cantidad LOCAL y DEDUPLICADAS -----------------------
-- Dos trampas se combinan aqui:
--
-- (a) CantidadEnsamble viene ACUMULADA desde el PT raiz, no local padre->hijo.
--     Se recupera la local dividiendo entre la cantidad de la fila del padre
--     (join por IdBomParent -> IdBom). Verificado contra BD: la arista
--     92691847-A -> 92691848-A sale con 2 o 6 segun el arbol, pero la local da
--     2 en los 5 arboles donde vive. En las 4,728 filas del universo la division
--     da entero exacto en el 100% de los casos. Misma regla que
--     `_cantidad_local` en domain/netteo.py — si cambias una, cambia la otra.
--
-- (b) La relacion (padre -> hijo) se repite una vez por cada PT raiz en cuyo
--     arbol aparece (4,724 filas -> 4,477 aristas unicas). Sumarlas
--     multiplicaria el requerimiento.
--
-- Por eso: se agrega DENTRO de cada arbol (un mismo padre puede listar al mismo
-- hijo en varias lineas/posiciones — eso SI suma) y se colapsa ENTRE arboles con
-- MAX. Como la local es invariante entre arboles, MAX solo actua de defensa ante
-- catalogos inconsistentes.
WITH cteDem AS (
    SELECT DISTINCT d.idMaterial
    FROM EPS.dbo.tblDemandaEPS d
    WHERE d.bActivo = 1
      AND d.Fecha  <= @cutoff
      AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
),
cteBom AS (
    SELECT b.IdMaterial, b.IdBom, b.IdBomParent, b.IdPadre, b.IdComponent, b.CantidadEnsamble
    FROM EPS.AppProc.tblBomExplosionado b
    WHERE b.IdMaterial IN (SELECT idMaterial FROM cteDem)
      AND b.IdTipoMaterial IN (1, 3)
),
cteAristaPorArbol AS (
    SELECT
       h.IdMaterial
      ,h.IdPadre
      ,h.IdComponent
      -- local = acumulada(hijo) / acumulada(padre). Sin fila de padre (quedo
      -- fuera del filtro de tipo) se usa la acumulada tal cual: ese nodo tampoco
      -- sera alcanzable desde una raiz.
      ,SUM(h.CantidadEnsamble / NULLIF(p.CantidadEnsamble, 0)) AS CantLocal
    FROM cteBom h
    JOIN cteBom p
      ON h.IdBomParent = p.IdBom
     AND h.IdMaterial  = p.IdMaterial
    WHERE h.IdPadre IS NOT NULL
      AND p.CantidadEnsamble <> 0
    GROUP BY h.IdMaterial, h.IdPadre, h.IdComponent
)
SELECT
   a.IdPadre                AS idPadre
  ,a.IdComponent            AS idComp
  ,MAX(a.CantLocal)         AS CantidadEnsamble
FROM cteAristaPorArbol a
GROUP BY a.IdPadre, a.IdComponent;


-- (3) WIP por componente --------------------------------------------------------
-- Solo el bucket que alimenta el netteo: Disponibles + Recibidas (= "por
-- procesar"). Mismas reglas que Q_detalle.sql: etiqueta activa, de liberacion,
-- LIBERADO, no remisionada. Aqui NO se desglosa por proceso — el netteo cross-PT
-- solo necesita el total por componente.
WITH cteDem AS (
    SELECT DISTINCT d.idMaterial
    FROM EPS.dbo.tblDemandaEPS d
    WHERE d.bActivo = 1
      AND d.Fecha  <= @cutoff
      AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
),
cteCompUniverso AS (
    SELECT DISTINCT b.IdComponent
    FROM EPS.AppProc.tblBomExplosionado b
    WHERE b.IdMaterial IN (SELECT idMaterial FROM cteDem)
      AND b.IdTipoMaterial IN (1, 3)
)
SELECT
   e.idMaterial            AS idComp
  ,SUM(e.cantidad)         AS Piezas
FROM EPS.Produccion.tblEtiqueta e
  LEFT JOIN EPS.Produccion.tblUbicacion u ON e.idUbicacion = u.idUbicacion
WHERE e.bActiva            = 1
  AND e.idTipoEtiqueta     = 3              -- LIBERACION
  AND e.idEstatusEtiqueta  = 2              -- LIBERADO
  AND e.idProcesoSiguiente IS NOT NULL      -- aun debe pasar por algun proceso
  AND e.idMaterial IN (SELECT IdComponent FROM cteCompUniverso)
  AND NOT EXISTS (
        SELECT 1
        FROM EPS.dbo.vwEtiquetasEnRemision red
        WHERE red.idEtiqueta = e.idEtiqueta
      )
GROUP BY e.idMaterial;


-- (4) PTs que demandan cada componente ------------------------------------------
-- Alimenta la leyenda del nodo compartido ("requerido tambien por N PTs").
-- Una fila por (componente, PT raiz).
WITH cteDem AS (
    SELECT DISTINCT d.idMaterial
    FROM EPS.dbo.tblDemandaEPS d
    WHERE d.bActivo = 1
      AND d.Fecha  <= @cutoff
      AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
)
SELECT DISTINCT
   b.IdComponent            AS idComp
  ,b.IdMaterial             AS idPT
FROM EPS.AppProc.tblBomExplosionado b
WHERE b.IdMaterial IN (SELECT idMaterial FROM cteDem)
  AND b.IdTipoMaterial IN (1, 3)
  AND b.IdComponent <> b.IdMaterial;   -- excluye la autorreferencia del PT raiz
