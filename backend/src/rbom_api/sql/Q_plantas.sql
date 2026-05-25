-- =============================================================================
-- Q_plantas.sql  -  Plantas con WIP activo (alimenta el selector de planta).
-- Devuelve solo las plantas que tienen al menos una etiqueta activa (no
-- remisionada) — evita poblar el dropdown con plantas inactivas.
-- =============================================================================

SELECT
    p.idPlanta
    ,p.Nombre AS NombrePlanta
FROM
    EPS.dbo.tblPlanta p
WHERE EXISTS (
    SELECT
    1
FROM
    EPS.Produccion.tblEtiqueta e
WHERE e.bActiva           = 1
    AND e.idEstatusEtiqueta = 2
    AND e.idTipoEtiqueta    = 3
    AND e.idPlantaProceso   = p.idPlanta
    AND NOT EXISTS (
            SELECT
        1
    FROM
        EPS.dbo.vwEtiquetasEnRemision red
    WHERE red.idEtiqueta = e.idEtiqueta
      )
)
ORDER BY p.Nombre;
