-- =============================================================================
-- Q_etiquetas_detalle.sql  -  Detalle de etiquetas que componen un bucket
-- especifico del bloque @idProcesoSelected.
--
-- Replica las MISMAS reglas que Q_bloques.sql para cada bucket -- la suma de
-- las cantidades de las filas devueltas debe igualar el conteo mostrado en la
-- card.
--
-- Parametros:
--   @idProcesoSelected int    Obligatorio.
--   @bucket            varchar(20)  Uno de: 'Disponibles', 'Recibidas',
--                                  'PorTransferir', 'Inspeccion', 'Retrabajo',
--                                  'Encaminadas'. El backend valida el valor antes.
--   @idPlantaFiltro    int?   Default NULL.
--   @idDestino         int?   Default NULL. Solo con bucket 'PorTransferir' (arista
--                                  con material) o 'Encaminadas' (arista de ruta sin
--                                  material aun): proceso destino Y de la arista X->Y.
--
-- Placeholders reemplazados desde Python (igual que Q_bloques):
--   /*CLIENTES_FILTER*/   "AND d.idCliente IN (...)" o "".
--   /*CIUDADES_FILTER*/   "AND d.idCiudad IN (...)" o "".
--   /*TIPOMAT_FILTER*/    "AND m.idTipoMaterial IN (...)" o "".
--   /*CLASE_FILTER*/      "AND I.CLASS_ID_ARTCULO_ID IN (...)" o "".
--
-- Devuelve, por etiqueta:
--   idEtiqueta, idMaterial, ClaveMaterial, DescripcionMaterial, cantidad,
--   UltimoProceso (procesoActual), SiguienteProceso, Ubicacion, idPlanta,
--   NombrePlanta.
-- =============================================================================

DECLARE @idProcesoSelected int          = @idProcesoSelected;
DECLARE @bucket            varchar(20)  = @bucket;
DECLARE @idPlantaFiltro    int          = @idPlantaFiltro;
DECLARE @conFiltroUniverso bit          = @conFiltroUniverso;
DECLARE @idDestino         int          = @idDestino;

WITH
    cteDem AS
    (
        SELECT DISTINCT d.idMaterial AS idPT
        FROM EPS.dbo.tblDemandaEPS d
        LEFT JOIN NETSUITE.dbo.ITEMS I ON I.ITEM_ID = d.ItemID
        WHERE d.bActivo = 1
            AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
        /*CLIENTES_FILTER*/
        /*CIUDADES_FILTER*/
        /*CLASE_FILTER*/
        /*PT_UNIVERSO_FILTER*/
    )
    ,cteCompUniv AS
    (
        SELECT DISTINCT b.IdComponent AS idComp
        FROM EPS.AppProc.tblBomExplosionado b
        JOIN cteDem d ON b.IdMaterial = d.idPT
        WHERE b.IdTipoMaterial IN (1, 3)
    )
    -- Ruta de fabricacion por material con su proceso siguiente (LEAD). Solo se
    -- usa para el bucket 'Encaminadas': identifica el material que aun esta en X
    -- (sig=X) y cuya ruta despues de X apunta al destino Y de la arista X->Y.
    -- Mismo patron que Q_flujo.sql (#ruta).
    ,cteRuta AS
    (
        SELECT
             mrt.idMaterial
            ,p.idProceso
            ,LEAD(p.idProceso) OVER (
                PARTITION BY mrt.idMaterial ORDER BY mrt.OrdenFabricacion
             ) AS idProcesoSiguiente
        FROM EPS.dbo.tblMaterialRutaTiempo mrt
        JOIN EPS.dbo.tblRuta    rt ON mrt.idRuta = rt.idRuta
        JOIN EPS.dbo.tblProceso p  ON rt.idProceso = p.idProceso
    )
    ,cteEtiq AS
    (
        SELECT
             e.idEtiqueta
            ,e.idMaterial
            ,m.ClaveMaterial
            ,m.Descripcion         AS DescripcionMaterial
            ,e.cantidad
            ,e.idEstatusEtiqueta
            ,e.idProcesoSiguiente
            ,e.idPlantaProceso     AS idPlanta
            ,e.idUbicacion
            ,u.idProceso           AS procesoUbicacion
            ,u.ubicacion           AS ubicacionNombre
            ,ep.idProceso          AS procesoActual
        FROM EPS.Produccion.tblEtiqueta e
        JOIN EPS.dbo.tblMaterial m ON e.idMaterial = m.idMaterial
        LEFT JOIN EPS.Produccion.tblUbicacion u ON e.idUbicacion = u.idUbicacion
        LEFT JOIN EPS.Produccion.tblEtiquetaProceso ep
               ON ep.idEtiqueta = e.idEtiqueta
              AND ep.bUltimoProceso = 1
        WHERE e.bActiva           = 1
            AND e.idTipoEtiqueta    = 3
            AND e.idEstatusEtiqueta IN (1, 2, 5)
            AND (@idPlantaFiltro IS NULL OR e.idPlantaProceso = @idPlantaFiltro)
            /*TIPOMAT_FILTER*/
            AND NOT EXISTS (
                SELECT 1 FROM EPS.dbo.vwEtiquetasEnRemision red
                WHERE red.idEtiqueta = e.idEtiqueta
            )
            AND (
                @conFiltroUniverso = 0
                OR EXISTS (SELECT 1 FROM cteCompUniv c WHERE c.idComp = e.idMaterial)
            )
    )
SELECT
     e.idEtiqueta
    ,e.idMaterial
    ,e.ClaveMaterial
    ,e.DescripcionMaterial
    ,e.cantidad
    ,e.idPlanta
    ,pp.Nombre   AS NombrePlanta
    ,e.procesoActual
    ,pa.Nombre   AS UltimoProceso
    ,e.idProcesoSiguiente
    ,ps.Nombre   AS SiguienteProceso
    ,e.procesoUbicacion
    ,pu.Nombre   AS UbicacionProceso
    ,e.ubicacionNombre
FROM cteEtiq e
LEFT JOIN EPS.dbo.tblProceso pa ON pa.idProceso = e.procesoActual
LEFT JOIN EPS.dbo.tblProceso ps ON ps.idProceso = e.idProcesoSiguiente
LEFT JOIN EPS.dbo.tblProceso pu ON pu.idProceso = e.procesoUbicacion
LEFT JOIN EPS.dbo.tblPlanta  pp ON pp.idPlanta  = e.idPlanta
WHERE
(
    -- Disponibles: estatus=2, sig=X, ubic <> X
    (
        @bucket = 'Disponibles'
        AND e.idEstatusEtiqueta = 2
        AND e.idProcesoSiguiente = @idProcesoSelected
        AND (e.procesoUbicacion IS NULL OR e.procesoUbicacion <> @idProcesoSelected)
    )
    OR
    -- Recibidas: estatus=2, sig=X, ubic = X
    (
        @bucket = 'Recibidas'
        AND e.idEstatusEtiqueta = 2
        AND e.idProcesoSiguiente = @idProcesoSelected
        AND e.procesoUbicacion = @idProcesoSelected
    )
    OR
    -- PorTransferir: estatus=2, procActual=X, sig != X, ubic <> sig
    (
        @bucket = 'PorTransferir'
        AND e.idEstatusEtiqueta = 2
        AND e.procesoActual = @idProcesoSelected
        AND e.idProcesoSiguiente IS NOT NULL
        AND e.idProcesoSiguiente <> @idProcesoSelected
        AND (e.procesoUbicacion IS NULL OR e.procesoUbicacion <> e.idProcesoSiguiente)
    )
    OR
    -- Inspeccion: estatus=1, procActual=X
    (
        @bucket = 'Inspeccion'
        AND e.idEstatusEtiqueta = 1
        AND e.procesoActual = @idProcesoSelected
    )
    OR
    -- Retrabajo: estatus=5, procActual=X
    (
        @bucket = 'Retrabajo'
        AND e.idEstatusEtiqueta = 5
        AND e.procesoActual = @idProcesoSelected
    )
    OR
    -- Encaminadas: material que TODAVIA no sale de X (sig=X, estatus=2 =
    -- Disponibles+Recibidas de X) pero cuya ruta despues de X apunta al destino
    -- Y. Es "lo que deberia irse" por la arista X->Y aunque PorTransferir=0.
    -- Solo aplica con @idDestino (arista del Flujo).
    (
        @bucket = 'Encaminadas'
        AND @idDestino IS NOT NULL
        AND e.idEstatusEtiqueta = 2
        AND e.idProcesoSiguiente = @idProcesoSelected
        AND EXISTS (
            SELECT 1 FROM cteRuta r
            WHERE r.idMaterial = e.idMaterial
              AND r.idProceso = @idProcesoSelected
              AND r.idProcesoSiguiente = @idDestino
        )
    )
)
-- Detalle de una arista del Flujo: acota el destino (solo con PorTransferir).
/*DESTINO_FILTER*/
ORDER BY e.cantidad DESC, e.idEtiqueta;
