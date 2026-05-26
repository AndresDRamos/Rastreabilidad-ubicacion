// Tipos de respuesta del backend FastAPI.
// Espejo del modelo pydantic en backend/src/rbom_api/domain/modelo.py.

export interface FilaListado {
  idMaterial: number;
  PT: string;
  Descripcion: string;
  idCliente: number | null;
  Cliente: string;
  idCiudad: number | null;
  Ciudad: string;
  idClase: number | null; // NETSUITE.dbo.ITEMS.CLASS_ID_ARTCULO_ID
  Clase: string | null;   // NETSUITE.dbo.CLASS_ID.LIST_ITEM_NAME
  PiezasPend: number;
  PiezasPastDue: number;
  FechaPromMin: string; // ISO date
  FechaPromMax: string;
  DiasAtrasoMax: number;
  Lineas: number;
  LineasFirme: number;
  LineasForecast: number;
}

export interface DemandaPT {
  idMaterial: number;
  PT: string;
  Descripcion: string;
  idCliente: number | null;
  Cliente: string;
  idCiudad: number | null;
  Ciudad: string;
  PiezasPend: number;
  FechaPromMin: string;
  FechaPromMax: string;
  PiezasPastDue: number;
}

export interface PasoRuta {
  orden: number;
  idProceso: number;
  proceso: string;
  ruta: string | null;
  idPlanta: number | null;
  es_virtual: boolean;
  req_paso: number;
  wip_en_paso: number;          // bucket "Por procesar" (alimenta el netteo)
  etiquetas_en_paso: number;
  liberadas: number;            // bUltimoProceso=1 ∧ estatus LIBERADO (solo display)
  etiquetas_liberadas: number;
  en_inspeccion: number;        // bUltimoProceso=1 ∧ estatus POR INSPECCION (solo display)
  etiquetas_inspeccion: number;
  label: string;
}

export interface AristaPadre {
  idPadre: number;
  cantidad_ensamble: number;
}

export interface NodoComponente {
  idComp: number;
  clave: string;
  descripcion: string | null;
  nivel: number;
  tipo_material: number; // 1 = PT, 3 = Intermedio
  cantidad_ensamble_total: number;
  req_bruto: number;
  wip_total: number;
  req_neto: number;
  ruta: PasoRuta[];
  cadena_ruta: string;
  padres: AristaPadre[];
  hijos: number[];
}

export interface ArbolPT {
  pt: DemandaPT;
  componentes: NodoComponente[];
  advertencias: string[];
}

export type Mode = "inventario" | "requerimiento";

// ---------- Vista Resumen ---------------------------------------------------

export interface BloqueProceso {
  idProceso: number | null;
  Proceso: string;
  Etiquetas: number;
  Piezas: number;
  Componentes: number;
  Plantas: number;
}

export interface PTEnProceso {
  idPT: number;
  PT: string;
  DescripcionPT: string | null;
  ComponentesEnProceso: number;
  PiezasEnProceso: number;
  EtiquetasEnProceso: number;
}

export interface Planta {
  idPlanta: number;
  NombrePlanta: string;
}
