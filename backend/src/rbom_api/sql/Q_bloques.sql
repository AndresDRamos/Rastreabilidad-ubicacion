-- =============================================================================
-- Q_bloques.sql  -  Vista Resumen: bloques (idProcesoSiguiente) con WIP activo
-- Una fila por proceso destino, agregando piezas/etiquetas/componentes/plantas.
-- Excluye etiquetas ya remisionadas (presentes en  EPS.dbo.vwEtiquetasEnRemision):
-- la sola presencia ya implica compromiso, aunque sigan bActiva = 1.
--
-- Parametros (NULL = sin filtro):
--   @idCliente         int  Si se provee, el universo se restringe a componentes
--                           de PTs con demanda activa de ese cliente.
--   @idPlantaFiltro    int  Si se provee, solo cuenta etiquetas con esa planta.
--   @conFiltroUniverso bit  Bandera que indica si materializar el universo
--                           restringido. Cuando = 0 la query devuelve el total
--                           EZI; cuando = 1 acota a componentes con demanda
--                           activa segun los filtros (cliente/ciudades).
--                           El placeholder /*CIUDADES_FILTER*/ se reemplaza en
--                           Python por "AND d.idCiudad IN (...)" si hay
--                           ciudades, "" en caso contrario.
-- =============================================================================

DECLARE @idCliente         int = @idCliente;
DECLARE @idPlantaFiltro    int = @idPlantaFiltro;
DECLARE @conFiltroUniverso bit = @conFiltroUniverso;

WITH
    cteDem
    AS
    (
        -- Materializa el set de PTs con demanda activa segun los filtros opcionales
        -- (cliente y/o ciudades). Se omite cuando @conFiltroUniverso = 0.
        SELECT
            DISTINCT
            d.idMaterial AS idPT
        FROM
            EPS.dbo.tblDemandaEPS d
        WHERE d.bActivo = 1
            AND (d.Cantidad - ISNULL(d.Embarcado, 0)) > 0
            AND (@idCliente IS NULL OR d.idCliente = @idCliente)
        /*CIUDADES_FILTER*/
    )
    ,cteCompUniv
    AS
    (
        SELECT
            DISTINCT
            b.IdComponent AS idComp
        FROM
            EPS.AppProc.tblBomExplosionado b
            JOIN cteDem d ON b.IdMaterial = d.idPT
        WHERE b.IdTipoMaterial IN (1, 3)
    )
    ,cteWIP
    AS
    (
        SELECT
            e.idMaterial      AS idComp
            ,e.idProcesoSiguiente
            ,e.idPlantaProceso AS idPlanta
            ,e.cantidad
        FROM
            EPS.Produccion.tblEtiqueta e
        WHERE e.bActiva           = 1
            AND e.idEstatusEtiqueta = 2 -- LIBERADO
            AND e.idTipoEtiqueta    = 3 -- LIBERACION
            AND NOT EXISTS (
            SELECT
                1
            FROM
                EPS.dbo.vwEtiquetasEnRemision red
            WHERE red.idEtiqueta = e.idEtiqueta
      )
            AND (
            @conFiltroUniverso = 0 -- vista total EZI
            OR EXISTS (                                -- restringir al universo
                SELECT
                1
            FROM
                cteCompUniv c
            WHERE c.idComp = e.idMaterial
            )
      )
    )
SELECT
    w.idProcesoSiguiente                              AS idProceso
    ,ISNULL(p.Nombre, '(sin proceso siguiente)')       AS Proceso
    ,COUNT(*)                                          AS Etiquetas
    ,SUM(w.cantidad)                                   AS Piezas
    ,COUNT(DISTINCT w.idComp)                          AS Componentes
    ,COUNT(DISTINCT w.idPlanta)                        AS Plantas
FROM
    cteWIP w
    LEFT JOIN EPS.dbo.tblProceso p ON w.idProcesoSiguiente = p.idProceso
WHERE (@idPlantaFiltro IS NULL OR w.idPlanta = @idPlantaFiltro)
GROUP BY w.idProcesoSiguiente, p.Nombre
ORDER BY Piezas DESC;
