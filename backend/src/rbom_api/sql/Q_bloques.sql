-- =============================================================================
-- Q_bloques.sql  -  Vista Resumen: bloques por proceso con 5 categorias de WIP
--
-- Una fila por "proceso X" con los siguientes conteos (mutuamente excluyentes
-- DENTRO de un mismo bloque; una misma etiqueta puede aparecer en dos bloques
-- distintos -- como saliente en X y como entrante en Y):
--
--   Disponibles    estatus=LIBERADO, idProcesoSiguiente=X, ubicacion <> X
--                  (la etiqueta espera entrar a X pero aun no llego fisicamente)
--   Recibidas      estatus=LIBERADO, idProcesoSiguiente=X, ubicacion = X
--                  (ya esta fisicamente en X esperando ser consumida)
--   PorTransferir  estatus=LIBERADO, procesoActual=X, idProcesoSiguiente<>X,
--                  ubicacion <> idProcesoSiguiente
--                  (X la libero pero aun NO ha llegado fisicamente al
--                   siguiente proceso. Cuando llega, deja de ser "Por
--                   transferir" en X y pasa a "Recibidas" del siguiente.)
--   Inspeccion     estatus=POR INSPECCION, procesoActual=X
--                  (salida de X bloqueada en QC)
--   Retrabajo      estatus=POR RETRABAJO, procesoActual=X
--                  (salida de X esperando retrabajo)
--
-- procesoActual = ultimo proceso por el que paso la etiqueta. Fuente de verdad:
-- Produccion.tblEtiquetaProceso con bUltimoProceso = 1 (directo, sin inferir
-- desde la ruta del componente). Si una etiqueta no tiene fila ahi (nunca fue
-- procesada por ningun proceso), procesoActual = NULL y no entra en PT/Insp/Ret.
--
-- El bloque X aparece si CUALQUIERA de los 5 conteos es > 0. Etiquetas y
-- Materiales son DISTINCT sobre la union (no la suma) -- una misma etiqueta
-- que cae en 2 buckets del mismo bloque (raro) cuenta solo una vez.
--
-- Excluye etiquetas ya remisionadas (presentes en vwEtiquetasEnRemision).
--
-- Parametros (NULL = sin filtro):
--   @idCliente         int  Restringe universo a componentes de PTs con
--                           demanda activa de ese cliente.
--   @idPlantaFiltro    int  Filtra por e.idPlantaProceso.
--   @conFiltroUniverso bit  Cuando = 1 acota a componentes con demanda activa
--                           segun los filtros (cliente/ciudades/clase). Cuando
--                           = 0, vista total EZI.
--
-- Placeholders reemplazados desde Python:
--   /*CIUDADES_FILTER*/  "AND d.idCiudad IN (...)" o "".
--   /*TIPOMAT_FILTER*/   "AND m.idTipoMaterial IN (...)" o "".
--   /*CLASE_FILTER*/     "AND I.CLASS_ID_ARTCULO_ID IN (...)" o "".
-- =============================================================================

DECLARE @idCliente         int = @idCliente;
DECLARE @idPlantaFiltro    int = @idPlantaFiltro;
DECLARE @conFiltroUniverso bit = @conFiltroUniverso;

WITH
    cteDem AS
    (
        SELECT DISTINCT d.idMaterial AS idPT
        FROM EPS.dbo.tblDemandaEPS d
        LEFT JOIN NETSUITE.dbo.ITEMS I ON I.ITEM_ID = d.ItemID
        WHERE d.bActivo = 1
            AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
            AND (@idCliente IS NULL OR d.idCliente = @idCliente)
        /*CIUDADES_FILTER*/
        /*CLASE_FILTER*/
    )
    ,cteCompUniv AS
    (
        SELECT DISTINCT b.IdComponent AS idComp
        FROM EPS.AppProc.tblBomExplosionado b
        JOIN cteDem d ON b.IdMaterial = d.idPT
        WHERE b.IdTipoMaterial IN (1, 3)
    )
    ,cteEtiq AS
    (
        -- Una fila por etiqueta calificada con su procesoUbicacion y
        -- procesoActual ya resueltos. Filtros aplicados aqui para minimizar
        -- el set de trabajo aguas abajo.
        SELECT
             e.idEtiqueta
            ,e.idMaterial
            ,e.cantidad
            ,e.idEstatusEtiqueta
            ,e.idProcesoSiguiente
            ,e.idPlantaProceso AS idPlanta
            ,u.idProceso       AS procesoUbicacion
            ,ep.idProceso      AS procesoActual
        FROM EPS.Produccion.tblEtiqueta e
        JOIN EPS.dbo.tblMaterial m ON e.idMaterial = m.idMaterial
        LEFT JOIN EPS.Produccion.tblUbicacion u ON e.idUbicacion = u.idUbicacion
        LEFT JOIN EPS.Produccion.tblEtiquetaProceso ep
               ON ep.idEtiqueta = e.idEtiqueta
              AND ep.bUltimoProceso = 1
        WHERE e.bActiva           = 1
            AND e.idTipoEtiqueta    = 3              -- LIBERACION
            AND e.idEstatusEtiqueta IN (1, 2, 5)      -- POR INSPECCION / LIBERADO / POR RETRABAJO
            AND (@idPlantaFiltro IS NULL OR e.idPlantaProceso = @idPlantaFiltro)
            /*TIPOMAT_FILTER*/
            AND NOT EXISTS (
                SELECT 1
                FROM EPS.dbo.vwEtiquetasEnRemision red
                WHERE red.idEtiqueta = e.idEtiqueta
            )
            AND (
                @conFiltroUniverso = 0
                OR EXISTS (
                    SELECT 1
                    FROM cteCompUniv c
                    WHERE c.idComp = e.idMaterial
                )
            )
    )
    ,cteUnpivot AS
    (
        -- Cada SELECT emite filas (idEtiqueta, idMaterial, cantidad, idPlanta,
        -- idProceso=X que representa el bloque, bucket).

        -- Disponibles: estatus=2, sig=X, ubic <> X
        SELECT
             idEtiqueta, idMaterial, cantidad, idPlanta
            ,idProcesoSiguiente AS idProceso
            ,CAST('Disponibles' AS varchar(20)) AS bucket
        FROM cteEtiq
        WHERE idEstatusEtiqueta = 2
          AND idProcesoSiguiente IS NOT NULL
          AND (procesoUbicacion IS NULL OR procesoUbicacion <> idProcesoSiguiente)

        UNION ALL

        -- Recibidas: estatus=2, sig=X, ubic = X
        SELECT
             idEtiqueta, idMaterial, cantidad, idPlanta
            ,idProcesoSiguiente AS idProceso
            ,CAST('Recibidas' AS varchar(20))
        FROM cteEtiq
        WHERE idEstatusEtiqueta = 2
          AND idProcesoSiguiente IS NOT NULL
          AND procesoUbicacion = idProcesoSiguiente

        UNION ALL

        -- PorTransferir: estatus=2, procActual=X, sig <> X, ubic <> sig
        -- (X la libero pero aun no ha llegado fisicamente al siguiente
        --  proceso; cuando ubic=sig, la etiqueta cuenta como "Recibidas"
        --  del siguiente y deja de ser "Por transferir" en X.)
        SELECT
             idEtiqueta, idMaterial, cantidad, idPlanta
            ,procesoActual AS idProceso
            ,CAST('PorTransferir' AS varchar(20))
        FROM cteEtiq
        WHERE idEstatusEtiqueta = 2
          AND procesoActual IS NOT NULL
          AND idProcesoSiguiente IS NOT NULL
          AND procesoActual <> idProcesoSiguiente
          AND (procesoUbicacion IS NULL OR procesoUbicacion <> idProcesoSiguiente)

        UNION ALL

        -- Inspeccion: estatus=1, procActual=X
        SELECT
             idEtiqueta, idMaterial, cantidad, idPlanta
            ,procesoActual AS idProceso
            ,CAST('Inspeccion' AS varchar(20))
        FROM cteEtiq
        WHERE idEstatusEtiqueta = 1
          AND procesoActual IS NOT NULL

        UNION ALL

        -- Retrabajo: estatus=5, procActual=X
        SELECT
             idEtiqueta, idMaterial, cantidad, idPlanta
            ,procesoActual AS idProceso
            ,CAST('Retrabajo' AS varchar(20))
        FROM cteEtiq
        WHERE idEstatusEtiqueta = 5
          AND procesoActual IS NOT NULL
    )
SELECT
     u.idProceso                                                            AS idProceso
    ,ISNULL(p.Nombre, '(sin proceso)')                                       AS Proceso
    ,SUM(CASE WHEN u.bucket = 'Disponibles'   THEN u.cantidad ELSE 0 END)    AS Disponibles
    ,SUM(CASE WHEN u.bucket = 'Recibidas'     THEN u.cantidad ELSE 0 END)    AS Recibidas
    ,SUM(CASE WHEN u.bucket = 'PorTransferir' THEN u.cantidad ELSE 0 END)    AS PorTransferir
    ,SUM(CASE WHEN u.bucket = 'Inspeccion'    THEN u.cantidad ELSE 0 END)    AS Inspeccion
    ,SUM(CASE WHEN u.bucket = 'Retrabajo'     THEN u.cantidad ELSE 0 END)    AS Retrabajo
    ,COUNT(DISTINCT u.idEtiqueta)                                            AS Etiquetas
    ,COUNT(DISTINCT u.idMaterial)                                            AS Materiales
    ,COUNT(DISTINCT u.idPlanta)                                              AS Plantas
FROM cteUnpivot u
LEFT JOIN EPS.dbo.tblProceso p ON u.idProceso = p.idProceso
GROUP BY u.idProceso, p.Nombre
ORDER BY (
    SUM(CASE WHEN u.bucket = 'Disponibles'   THEN u.cantidad ELSE 0 END)
  + SUM(CASE WHEN u.bucket = 'Recibidas'     THEN u.cantidad ELSE 0 END)
  + SUM(CASE WHEN u.bucket = 'PorTransferir' THEN u.cantidad ELSE 0 END)
) DESC;
