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
  /** Cantidad LOCAL (piezas por unidad del padre), ya derivada de la acumulada. */
  cantidad_ensamble: number;
}

/**
 * Requerimiento de un componente sumando TODOS los PTs con demanda que lo piden.
 *
 * NO cuadra con `NodoComponente.req_bruto` a proposito: el arbol abierto se
 * atribuye el 100% del WIP fisico del componente, mientras que el universo
 * reparte ese mismo WIP entre todos los PTs que lo reclaman. Cuando n_pts > 1
 * la UI debe advertirlo.
 */
export interface ReqUniverso {
  req_bruto_total: number;
  req_neto_total: number;
  wip_total: number;
  n_pts: number;
  pts: string[];
  ciclico: boolean;
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
  /** Requerimiento cross-PT. null si el universo no se pudo calcular. */
  req_universo: ReqUniverso | null;
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
  // El bloque se desglosa por planta: una fila por (proceso X, planta).
  idPlanta: number | null;
  NombrePlanta: string | null;
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

// Drill-down dentro del drawer lateral del bloque: una fila por etiqueta.
export type BloqueBucket =
  | "Disponibles"
  | "Recibidas"
  | "PorTransferir"
  | "Inspeccion"
  | "Retrabajo"
  // Arista de ruta en cero: material aun en el origen cuya ruta apunta al
  // destino. Requiere ?destino=. Solo se usa desde el click de una arista vacia.
  | "Encaminadas";

export interface EtiquetaDetalle {
  idEtiqueta: number;
  idMaterial: number;
  ClaveMaterial: string;
  DescripcionMaterial: string | null;
  cantidad: number;
  idPlanta: number | null;
  NombrePlanta: string | null;
  procesoActual: number | null;
  UltimoProceso: string | null;
  idProcesoSiguiente: number | null;
  SiguienteProceso: string | null;
  procesoUbicacion: number | null;
  UbicacionProceso: string | null;
  ubicacionNombre: string | null;
}

// ---------- Universo de filtrado (pestana del sidebar) ----------------------

// "general" = todo el universo de demanda. "caterpillar" = solo los idMaterial
// del CSV de numeros criticos (NumerosCriticos.csv, lado backend).
export type Universo = "general" | "caterpillar";

// Modo de la vista Resumen: tarjetas sueltas o grafo de flujo conectado.
export type ResumenMode = "cards" | "flujo";

// ---------- Vista Flujo: grafo de procesos conectados -----------------------

export interface FlujoBloque {
  idProceso: number | null;
  Proceso: string;
  idPlanta: number | null;
  NombrePlanta: string | null;
  // Aparición del proceso en la ruta (1ª, 2ª...). Un mismo proceso repetido se
  // dibuja como nodos distintos por fase (flujo limpio izq→der). null = puerta.
  Fase: number | null;
  // Posición representativa en la secuencia de fabricación (mediana de
  // OrdenFabricacion). El layout ordena columnas por este valor. null = nodo
  // sin ruta (solo WIP huérfano).
  Rango: number | null;
  Recibidas: number;     // estatus=LIBERADO, sig=Y, ubic=Y
  Disponibles: number;   // estatus=LIBERADO, sig=Y, ubic<>Y (= Σ aristas entrantes)
  Inspeccion: number;    // estatus=POR INSPECCION, procActual=Y
  Retrabajo: number;     // estatus=POR RETRABAJO, procActual=Y
  Etiquetas: number;
  Materiales: number;
  // Nodo-PUERTA: planta externa que surte/recibe en el drill-in. idProceso/Fase
  // = null, conteos = 0 (el material vive en la arista). 'in' entra (borde izq);
  // 'out' sale (borde der).
  EsPuerta: boolean;
  idPlantaVecina: number | null;
  NombrePlantaVecina: string | null;
  Direccion: "in" | "out" | null;
}

export interface FlujoArista {
  idProcesoOrigen: number | null;
  ProcesoOrigen: string;
  FaseOrigen: number;
  idProcesoDestino: number | null;
  ProcesoDestino: string;
  FaseDestino: number;
  idPlanta: number | null;
  Piezas: number;        // = PorTransferir de origen hacia destino
  Etiquetas: number;
  // Arista de PUERTA (cruce interplanta). 'in' → el origen es la puerta; 'out' →
  // el destino es la puerta. ProcesoFrontera = proceso que surte/recibe en la
  // otra planta (rótulo).
  EsInterPlanta: boolean;
  Direccion: "in" | "out" | null;
  idPlantaVecina: number | null;
  NombrePlantaVecina: string | null;
  ProcesoFrontera: string | null;
}

export interface FlujoResponse {
  bloques: FlujoBloque[];
  aristas: FlujoArista[];
}

// ---------- Vista Flujo, nivel PLANTA (overview) ----------------------------

export interface FlujoPlantaNodo {
  idPlanta: number | null;
  NombrePlanta: string | null;
  // Mediana de OrdenFabricacion de los pasos de la planta. Ordena izquierda
  // (fabricación) → derecha (embarque). null = sin ruta.
  Rango: number | null;
  Recibidas: number;
  Disponibles: number;
  Inspeccion: number;
  Retrabajo: number;
  Etiquetas: number;
  Materiales: number;
  Procesos: number; // cuántos procesos distintos corre la planta
}

export interface FlujoPlantaArista {
  idPlantaOrigen: number | null;
  PlantaOrigen: string;
  idPlantaDestino: number | null;
  PlantaDestino: string;
  Piezas: number;      // material en tránsito A→B ahora (color/animación)
  Etiquetas: number;
  Componentes: number; // componentes que rutan A→B (grosor de la arista)
}

export interface FlujoPlantasResponse {
  nodos: FlujoPlantaNodo[];
  aristas: FlujoPlantaArista[];
}
