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
    idCliente: Optional[int] = None
    Cliente: str
    idCiudad: Optional[int] = None
    Ciudad: str
    idClase: Optional[int] = None    # NETSUITE.dbo.ITEMS.CLASS_ID_ARTCULO_ID
    Clase: Optional[str] = None      # NETSUITE.dbo.CLASS_ID.LIST_ITEM_NAME
    PiezasPend: float
    PiezasPastDue: float
    FechaPromMin: date
    FechaPromMax: date
    DiasAtrasoMax: int
    Lineas: int
    LineasFirme: int
    LineasForecast: int


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
    - `Piezas` / `Etiquetas` = Disponibles + Recibidas (lo que aun debe pasar
      por X). Es el conjunto que alimenta el netteo via `wip_en_paso`.

    Desglose display (no afecta el netteo):
    - `PiezasDisponibles` / `EtiquetasDisponibles` = estatus=LIBERADO, sig=X,
      ubicacion <> X (espera entrar, fisicamente fuera de X).
    - `PiezasRecibidas` / `EtiquetasRecibidas` = estatus=LIBERADO, sig=X,
      ubicacion = X (ya esta fisicamente en X).
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
    EtiquetasLiberadas: int = 0
    PiezasLiberadas: float = 0.0
    EtiquetasInspeccion: int = 0
    PiezasInspeccion: float = 0.0
    EtiquetasRetrabajo: int = 0
    PiezasRetrabajo: float = 0.0


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
    req_paso: float = 0.0           # piezas que aun deben pasar por este step
    # wip_en_paso = Disponibles + Recibidas (suma compat con el netteo).
    # Es el unico campo que descuenta req_paso.
    wip_en_paso: float = 0.0
    etiquetas_en_paso: int = 0
    # Desglose display del WIP que aun debe pasar por X
    disponibles: float = 0.0        # estatus=LIBERADO, sig=X, ubic <> X
    etiquetas_disponibles: int = 0
    recibidas: float = 0.0          # estatus=LIBERADO, sig=X, ubic = X
    etiquetas_recibidas: int = 0
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
    wip_total: float
    req_neto: float                 # demanda neta despues de descontar WIP
    ruta: list[PasoRuta] = Field(default_factory=list)
    cadena_ruta: str = ""           # ej. "Corte (0 de 0) -> Doblez (120 de 200) -> ..."
    padres: list[AristaPadre] = Field(default_factory=list)
    hijos: list[int] = Field(default_factory=list)


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
    Plantas: int


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
