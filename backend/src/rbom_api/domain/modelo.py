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
    idComp: int
    idProcesoSiguiente: Optional[int] = None
    ProcesoSiguiente: str
    Etiquetas: int
    Piezas: float


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
    wip_en_paso: float = 0.0        # piezas con idProcesoSiguiente = idProceso_de_este_paso
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
