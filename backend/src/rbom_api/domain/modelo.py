"""Modelos de datos: entradas crudas de SQL y arbol netteado."""

from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class _Base(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


# ---------- Result-sets de Q_listado.sql / Q_detalle.sql ---------------------

class FilaListado(_Base):
    idMaterial: int
    PT: str
    Descripcion: str
    # 1 = la demanda existe pero su idMaterial (0 o NULL) no esta en tblMaterial.
    # Es demanda REAL: cuenta piezas, pero no tiene BOM ni ruta -> sin arbol.
    bSinMaterial: bool = False
    idCliente: Optional[int] = None
    Cliente: str
    idCiudad: Optional[int] = None
    Ciudad: str
    idClase: Optional[int] = None    # vwClassIDMaterial.CLASS_ID_ARTCULO_ID
    Clase: Optional[str] = None      # vwClassIDMaterial.LIST_ITEM_NAME
    PiezasPend: float
    PiezasPastDue: float
    FechaPromMin: date
    FechaPromMax: date
    DiasAtrasoMax: int
    Lineas: int
    LineasFirme: int
    LineasForecast: int


class CeldaCalendario(_Base):
    """Una fila del result-set de Q_requerimiento_calendario.sql.

    Demanda activa desagregada por (PT x Cliente x Ciudad x Fecha[dia] x
    bForecast). El frontend agrupa por (idMaterial, idCliente, idCiudad) y
    bucketiza `Fecha` a dia/semana/mes; el past-due es la suma de dias < hoy.
    PiezasPend ya descuenta lo embarcado.
    """
    idMaterial: int
    PT: str
    Descripcion: str
    # Ver FilaListado.bSinMaterial — el calendario es demanda BRUTA, asi que la
    # linea sin material catalogado sigue contando piezas.
    bSinMaterial: bool = False
    idCliente: Optional[int] = None
    Cliente: str
    idCiudad: Optional[int] = None
    Ciudad: str
    Fecha: date
    bForecast: bool
    PiezasPend: float


class OrdenLinea(_Base):
    """Una linea de demanda que compone una celda del calendario (popover de
    detalle). Sale de Q_orden_detalle.sql."""
    OrdenVenta: Optional[str] = None
    POHeader: Optional[str] = None
    POLine: Optional[str] = None
    Fecha: date
    bForecast: bool
    PiezasPend: float
    PrecioUnitario: Optional[float] = None


class CeldaEmbarque(_Base):
    """Una fila del result-set de Q_embarques_calendario.sql.

    Historial de embarques (remisiones) desagregado por (PT x Cliente x Ciudad x
    Fecha[dia]). Espejo hacia el PASADO de CeldaCalendario: el frontend agrupa
    por (idMaterial, idCliente, idCiudad) y bucketiza `Fecha` a dia/semana/mes,
    pintandolo a la IZQUIERDA de la columna Past-due. `PiezasEmbarcadas` =
    SUM(vwRemisiones.CantidadRemision).
    """
    idMaterial: int
    PT: str
    Descripcion: str
    idCliente: Optional[int] = None
    Cliente: str
    idCiudad: Optional[int] = None
    Ciudad: str
    Fecha: date
    PiezasEmbarcadas: float


class RemisionLinea(_Base):
    """Una linea de remision que compone una celda de embarque (popover de
    detalle). Sale de Q_remision_detalle.sql."""
    Remision: Optional[str] = None
    Factura: Optional[str] = None
    OrdenVenta: Optional[str] = None
    OrdenCompra: Optional[str] = None
    Fecha: date
    Piezas: float
    PrecioUnitario: Optional[float] = None


class DemandaPT(_Base):
    idMaterial: int
    PT: str
    Descripcion: str
    idCliente: Optional[int] = None
    Cliente: str
    idCiudad: Optional[int] = None
    Ciudad: str = ""
    PiezasPend: float
    FechaPromMin: date
    FechaPromMax: date
    PiezasPastDue: float


class FilaBom(_Base):
    IdBom: int
    IdBomParent: Optional[int] = None
    BomLevel: int
    idComp: int
    Componente: str
    DescripcionComp: Optional[str] = None
    IdPadre: Optional[int] = None
    ClavePadre: Optional[str] = None
    idTipoMat: int
    TipoMaterial: Optional[str] = None
    CantidadEnsamble: float
    HijosTotales: int
    bLastLevel: bool
    idPlanta: Optional[int] = None
    PrimerIdProceso: Optional[int] = None
    PrimerProceso: Optional[str] = None
    UltimoIdProceso: Optional[int] = None
    UltimoProceso: Optional[str] = None


class FilaRuta(_Base):
    idComp: int
    OrdenRuta: int
    idRuta: int
    Ruta: str
    idProceso: int
    Proceso: str
    OrdenProceso: Optional[int] = None
    IdPlanta: Optional[int] = None
    TiempoProceso: Optional[int] = None
    idProcesoSiguiente: Optional[int] = None
    ProcesoSiguiente: Optional[str] = None


class FilaWip(_Base):
    """WIP por (componente, proceso) en 5 buckets.

    Compat con el netteo:
    - `Piezas` / `Etiquetas` = Disponibles + Recibidas + EnInspeccionSig (lo que
      aun debe pasar por X). Es el conjunto que alimenta el netteo via
      `wip_en_paso`.

    Desglose del bucket que netea:
    - `PiezasDisponibles` / `EtiquetasDisponibles` = estatus=LIBERADO, sig=X,
      ubicacion <> X (espera entrar, fisicamente fuera de X).
    - `PiezasRecibidas` / `EtiquetasRecibidas` = estatus=LIBERADO, sig=X,
      ubicacion = X (ya esta fisicamente en X).
    - `PiezasInspeccionSig` / `EtiquetasInspeccionSig` = estatus=POR INSPECCION,
      sig=X. Va camino a X pero sigue en QC. **Cuenta en el netteo desde
      2026-08-03** (huella FIFO del CLR: 4% de las asignaciones, 99.5% de
      acierto) — es lo que hace `plan-capacidad`, y unificarlo puso a los dos
      motores a netear contra el mismo pool.

    Desglose display (no afecta el netteo):
    - `PiezasLiberadas` / `EtiquetasLiberadas` = piezas que ya salieron de X
      (procesoActual=X, sig <> X). Reemplaza al viejo "Liberadas".
    - `PiezasInspeccion` / `EtiquetasInspeccion` = bUltimoProceso=X ∧ estatus
      POR INSPECCION.
    - `PiezasRetrabajo` / `EtiquetasRetrabajo` = bUltimoProceso=X ∧ estatus
      POR RETRABAJO.
    """
    idComp: int
    idProceso: Optional[int] = None
    Proceso: str
    Etiquetas: int = 0
    Piezas: float = 0.0
    EtiquetasDisponibles: int = 0
    PiezasDisponibles: float = 0.0
    EtiquetasRecibidas: int = 0
    PiezasRecibidas: float = 0.0
    EtiquetasInspeccionSig: int = 0
    PiezasInspeccionSig: float = 0.0
    EtiquetasLiberadas: int = 0
    PiezasLiberadas: float = 0.0
    EtiquetasInspeccion: int = 0
    PiezasInspeccion: float = 0.0
    EtiquetasRetrabajo: int = 0
    PiezasRetrabajo: float = 0.0


# ---------- Result-sets de Q_universo_req.sql --------------------------------
# Insumos del netteo CROSS-PT (bosque completo). Ver domain/universo_req.py.

class FilaDemandaUniverso(_Base):
    """Un PT raiz con demanda activa, ya agregada (sin desglose cliente/ciudad)."""
    idMaterial: int
    PT: str
    PiezasPend: float
    # Promesa mas antigua pendiente del PT. Es la llave del reparto FIFO del WIP
    # compartido: el mas vencido se sirve primero. None = sin fecha (va al final).
    FechaPromMin: Optional[date] = None


class FilaAristaUniverso(_Base):
    """Arista padre->hijo del bosque, YA deduplicada a nivel universo.

    `tblBomExplosionado` repite la misma relacion una vez por cada PT en cuyo
    arbol aparece; Q_universo_req.sql la colapsa antes de llegar aqui.
    """
    idPadre: int
    idComp: int
    CantidadEnsamble: float


class FilaWipUniverso(_Base):
    """WIP por componente (bucket "por procesar" = Disponibles + Recibidas)."""
    idComp: int
    Piezas: float = 0.0


class ReqUniverso(_Base):
    """Requerimiento de un componente sumando TODOS los PTs que lo demandan.

    Convive con el requerimiento del arbol abierto (`NodoComponente.req_bruto`)
    y **no cuadra con el**: el arbol se atribuye el 100% del WIP fisico del
    componente, mientras que este reparte ese WIP entre todos los PTs que lo
    reclaman. La UI debe advertirlo cuando `n_pts > 1`.
    """
    req_bruto_total: float      # demanda agregada de todos los padres, sin WIP
    req_neto_total: float       # = max(0, req_bruto_total - wip_total)
    wip_total: float            # WIP fisico del componente (se descuenta 1 vez)
    n_pts: int                  # cuantos PT raiz lo demandan
    pts: list[str] = Field(default_factory=list)  # claves de PT (tope 20)
    ciclico: bool = False       # true si quedo en un ciclo del BOM (dato sucio)


# ---------- Salida JSON: arbol netteado --------------------------------------

class PasoRuta(_Base):
    """Un paso del flujo de fabricacion de un componente.

    El nodo virtual `Almacen WIP` se agrega al final de la ruta de cada
    intermedio (no del PT raiz) para representar el buffer donde el componente
    espera consumo por su padre.
    """
    orden: int
    idProceso: int
    proceso: str
    ruta: Optional[str] = None
    idPlanta: Optional[int] = None
    es_virtual: bool = False
    # LA CARGA DEL PROCESO: piezas que este paso tiene que procesar, incluidas las
    # que ya estan esperando en el. Es la columna `Piezas` del CapacidadDetalle y
    # el numero que muestra el ProcessNode en modo Requerimiento.
    faltante: float = 0.0
    # Lo que AUN NO HA LLEGADO a este paso: faltante - wip_en_paso. Alimenta el
    # netteo aguas arriba; no es la carga del proceso.
    req_paso: float = 0.0
    # wip_en_paso = Disponibles + Recibidas + EnInspeccionSig (suma compat con el
    # netteo). Es el unico campo que descuenta req_paso.
    wip_en_paso: float = 0.0
    etiquetas_en_paso: int = 0
    # Desglose del WIP que aun debe pasar por X (los tres SI netean)
    disponibles: float = 0.0        # estatus=LIBERADO, sig=X, ubic <> X
    etiquetas_disponibles: int = 0
    recibidas: float = 0.0          # estatus=LIBERADO, sig=X, ubic = X
    etiquetas_recibidas: int = 0
    en_inspeccion_sig: float = 0.0  # estatus=POR INSPECCION, sig=X (en QC, va a X)
    etiquetas_inspeccion_sig: int = 0
    # Salidas de X (solo display)
    liberadas: float = 0.0          # estatus=LIBERADO, procActual=X, sig <> X
    etiquetas_liberadas: int = 0
    en_inspeccion: float = 0.0      # estatus=POR INSPECCION, procActual=X
    etiquetas_inspeccion: int = 0
    retrabajo: float = 0.0          # estatus=POR RETRABAJO, procActual=X
    etiquetas_retrabajo: int = 0
    label: str = ""                 # ej. "Doblez (120 de 200)"


class AristaPadre(_Base):
    """Relacion hijo->padre con la cantidad de ensamble de esa aparicion."""
    idPadre: int
    cantidad_ensamble: float


class NodoComponente(_Base):
    idComp: int
    clave: str
    descripcion: Optional[str] = None
    nivel: int
    tipo_material: int              # 1 = PT, 3 = Intermedio
    cantidad_ensamble_total: float  # suma de CantEnsamble por todas las apariciones
    req_bruto: float                # demanda total antes de descontar WIP
    # WIP que ESTE PT puede consumir: su cuota del reparto FIFO cuando el
    # componente es compartido. Es el que descuenta `req_neto`.
    wip_total: float
    # Piezas fisicas en piso del componente, SIN repartir. Igual a `wip_total`
    # cuando nadie mas reclama el componente. La card muestra "wip_total de
    # wip_fisico en piso" para que el reparto sea visible.
    wip_fisico: float = 0.0
    req_neto: float                 # demanda neta despues de descontar WIP
    ruta: list[PasoRuta] = Field(default_factory=list)
    cadena_ruta: str = ""           # ej. "Corte (0 de 0) -> Doblez (120 de 200) -> ..."
    padres: list[AristaPadre] = Field(default_factory=list)
    hijos: list[int] = Field(default_factory=list)
    # Requerimiento del componente a traves de TODOS los PTs con demanda (no
    # solo este arbol). None si el universo no se pudo calcular. Ver
    # domain/universo_req.py — no cuadra con req_bruto a proposito.
    req_universo: Optional[ReqUniverso] = None


class ArbolPT(_Base):
    pt: DemandaPT
    componentes: list[NodoComponente]
    advertencias: list[str] = Field(default_factory=list)


# ---------- Vista Resumen: bloques por proceso ------------------------------

class BloqueProceso(_Base):
    """Una fila por "proceso X" con los 5 conteos de WIP que reflejan estados
    del flujo alrededor de X (ver Q_bloques.sql para reglas exactas).

    Una misma etiqueta puede aparecer en dos bloques distintos (como
    "PorTransferir" en X y como "Disponibles/Recibidas" en Y), pero dentro de
    un mismo bloque cae en una sola categoria.
    """
    idProceso: Optional[int] = None
    Proceso: str
    # El bloque se desglosa por planta: una fila por (proceso X, planta).
    idPlanta: Optional[int] = None
    NombrePlanta: Optional[str] = None
    # Buckets sobre estatus=LIBERADO (idEstatusEtiqueta=2)
    Disponibles: float       # sig=X, ubic <> X (esperando entrar, no llego)
    Recibidas: float         # sig=X, ubic = X (ya esta fisicamente en X)
    PorTransferir: float     # prev=X, sig <> X (X la libero)
    # Buckets sobre otros estatus de salida de X
    Inspeccion: float        # estatus=POR INSPECCION, prev=X
    Retrabajo: float         # estatus=POR RETRABAJO, prev=X
    # Totales del bloque (DISTINCT sobre la union de las 5 categorias)
    Etiquetas: int
    Materiales: int          # COUNT DISTINCT idMaterial (antes 'Componentes')


class PTEnProceso(_Base):
    """Un PT cuyos componentes tienen WIP asociado al proceso seleccionado en
    el drill-down de la vista Resumen.

    Devuelve las 3 metricas principales por PT (Disponibles, Recibidas,
    PorTransferir) -- Insp/Retr no se desglosan a nivel PT. El badge del PT
    en frontend renderiza una de esas tres segun la metrica elegida por el
    usuario.
    """
    idPT: int
    PT: str
    DescripcionPT: Optional[str] = None
    ComponentesEnProceso: int
    EtiquetasEnProceso: int
    Disponibles: float
    Recibidas: float
    PorTransferir: float


class Planta(_Base):
    """Alimenta el selector de planta en la vista Resumen."""
    idPlanta: int
    NombrePlanta: str


# ---------- Vista Flujo: grafo de procesos conectados ------------------------

class FlujoBloque(_Base):
    """Un bloque del grafo de Flujo = un proceso en una planta.

    La estructura sale de la ruta de fabricacion (puede no tener WIP -> conteos
    en 0). Los conteos son los que viven "dentro" del bloque (ver Q_flujo.sql).
    `Disponibles` debe coincidir con la suma de las aristas entrantes.
    """
    idProceso: Optional[int] = None
    Proceso: str
    idPlanta: Optional[int] = None
    NombrePlanta: Optional[str] = None
    # Aparicion del proceso en la ruta (1a, 2a...). Un mismo proceso repetido en
    # la ruta se dibuja como nodos distintos por fase, para leer el flujo de
    # izquierda a derecha sin retornos. None en los nodos-puerta.
    Fase: Optional[int] = 1
    # Posicion representativa en la secuencia de fabricacion (mediana de
    # OrdenFabricacion). El layout la usa para ordenar columnas izquierda
    # (temprano) -> derecha (tardio). None = nodo sin ruta (solo WIP huerfano).
    Rango: Optional[float] = None
    Recibidas: float = 0.0
    Disponibles: float = 0.0
    Inspeccion: float = 0.0
    Retrabajo: float = 0.0
    Etiquetas: int = 0
    Materiales: int = 0
    # Nodo-PUERTA: representa una planta externa que surte/recibe material en el
    # drill-in de una planta. idProceso/Fase son None; los conteos son 0 (el
    # material en transito vive en la arista de puerta). Direccion 'in' = entra a
    # la planta (borde izq); 'out' = sale (borde der).
    EsPuerta: bool = False
    idPlantaVecina: Optional[int] = None
    NombrePlantaVecina: Optional[str] = None
    Direccion: Optional[str] = None       # 'in' | 'out' | None


class FlujoArista(_Base):
    """Una arista del grafo = material que el proceso origen libero y va en
    transito hacia el proceso destino (= PorTransferir de X hacia Y). La
    estructura sale de la ruta; `Piezas`/`Etiquetas` = 0 si no hay material."""
    idProcesoOrigen: Optional[int] = None
    ProcesoOrigen: str
    FaseOrigen: int = 1
    idProcesoDestino: Optional[int] = None
    ProcesoDestino: str
    FaseDestino: int = 1
    idPlanta: Optional[int] = None
    Piezas: float = 0.0
    Etiquetas: int = 0
    # Arista de PUERTA (cruce interplanta). Uno de los extremos es un nodo-puerta
    # (la planta vecina); el otro es un proceso real de la planta del drill.
    # Direccion 'in' -> el origen es la puerta; 'out' -> el destino es la puerta.
    # ProcesoFrontera = nombre del proceso que surte (in) o recibe (out) en la
    # otra planta, para rotular la arista.
    EsInterPlanta: bool = False
    Direccion: Optional[str] = None       # 'in' | 'out' | None
    idPlantaVecina: Optional[int] = None
    NombrePlantaVecina: Optional[str] = None
    ProcesoFrontera: Optional[str] = None


class FlujoResponse(_Base):
    bloques: list[FlujoBloque] = Field(default_factory=list)
    aristas: list[FlujoArista] = Field(default_factory=list)


# ---------- Vista Flujo, nivel PLANTA (overview) -----------------------------

class FlujoPlantaNodo(_Base):
    """Un bloque del overview = una planta con su WIP interno total (suma de
    todos sus procesos). `Rango` (mediana de OrdenFabricacion de sus pasos)
    ordena las plantas izquierda (fabricacion) -> derecha (embarque)."""
    idPlanta: Optional[int] = None
    NombrePlanta: Optional[str] = None
    Rango: Optional[float] = None
    Recibidas: float = 0.0
    Disponibles: float = 0.0
    Inspeccion: float = 0.0
    Retrabajo: float = 0.0
    Etiquetas: int = 0
    Materiales: int = 0
    Procesos: int = 0


class FlujoPlantaArista(_Base):
    """Una arista del overview = material liberado en la planta origen cuyo
    siguiente proceso vive en la planta destino (PorTransferir interplanta). La
    estructura sale de la ruta; `Piezas`/`Etiquetas` = 0 si no hay material."""
    idPlantaOrigen: Optional[int] = None
    PlantaOrigen: str
    idPlantaDestino: Optional[int] = None
    PlantaDestino: str
    Piezas: float = 0.0        # material en transito A->B ahora (color/animacion)
    Etiquetas: int = 0
    Componentes: int = 0       # componentes que rutan A->B (grosor de la arista)


class FlujoPlantasResponse(_Base):
    nodos: list[FlujoPlantaNodo] = Field(default_factory=list)
    aristas: list[FlujoPlantaArista] = Field(default_factory=list)


class EtiquetaDetalle(_Base):
    """Una fila por etiqueta que compone un bucket de un bloque de la vista
    Resumen (drill-down dentro del drawer lateral)."""
    idEtiqueta: int
    idMaterial: int
    ClaveMaterial: str
    DescripcionMaterial: Optional[str] = None
    cantidad: float
    idPlanta: Optional[int] = None
    NombrePlanta: Optional[str] = None
    procesoActual: Optional[int] = None
    UltimoProceso: Optional[str] = None
    idProcesoSiguiente: Optional[int] = None
    SiguienteProceso: Optional[str] = None
    procesoUbicacion: Optional[int] = None
    UbicacionProceso: Optional[str] = None
    ubicacionNombre: Optional[str] = None
