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
  // wip_en_paso = disponibles + recibidas (lo que aun debe pasar por X);
  // unico que alimenta el netteo.
  wip_en_paso: number;
  etiquetas_en_paso: number;
  // Desglose display del WIP que aun debe pasar por X
  disponibles: number;         // estatus=LIBERADO, sig=X, ubic <> X
  etiquetas_disponibles: number;
  recibidas: number;           // estatus=LIBERADO, sig=X, ubic = X
  etiquetas_recibidas: number;
  // Salidas de X (solo display)
  liberadas: number;           // estatus=LIBERADO, procActual=X, sig <> X
  etiquetas_liberadas: number;
  en_inspeccion: number;       // estatus=POR INSPECCION, procActual=X
  etiquetas_inspeccion: number;
  retrabajo: number;           // estatus=POR RETRABAJO, procActual=X
  etiquetas_retrabajo: number;
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
  // Buckets sobre estatus=LIBERADO
  Disponibles: number;      // sig=X, ubic <> X
  Recibidas: number;        // sig=X, ubic = X
  PorTransferir: number;    // prev=X, sig <> X
  // Buckets sobre otros estatus de salida de X
  Inspeccion: number;       // estatus=POR INSPECCION, prev=X
  Retrabajo: number;        // estatus=POR RETRABAJO, prev=X
  // Totales del bloque
  Etiquetas: number;
  Materiales: number;       // antes 'Componentes' — ahora COUNT DISTINCT idMaterial
  Plantas: number;
}

export interface PTEnProceso {
  idPT: number;
  PT: string;
  DescripcionPT: string | null;
  ComponentesEnProceso: number;
  EtiquetasEnProceso: number;
  Disponibles: number;
  Recibidas: number;
  PorTransferir: number;
}

// Metrica activa del drill-down de PTs bajo un bloque seleccionado.
// El badge del PT y el orden del listado se renderizan segun esta seleccion.
export type DrilldownMetric = "disponibles" | "recibidas" | "por_transferir" | "total";

export interface Planta {
  idPlanta: number;
  NombrePlanta: string;
}
