import { create } from "zustand";

import type {
  BloqueBucket,
  CalGranularidad,
  CalModo,
  DrilldownMetric,
  Mode,
  ResumenMode,
  Universo,
} from "@/api/types";

/** Alcance temporal de la demanda. Reemplaza al filtro de fecha libre: son los
 *  cuatro cortes que responden preguntas distintas del piso.
 *
 *  Medido 2026-08-03 sobre la demanda viva y sobre lo que el piso procesa en la
 *  semana en curso (ver, en ezi-data-core, activos/RastreabilidadBOM/decisiones.md):
 *  - `pastdue`  251,447 pzs — la deuda vencida, 100% urgente.
 *  - `4sem`     621,419 pzs — cubre el 95.6% de lo que el piso corre ESTA semana.
 *  - `3meses` 1,597,390 pzs — cubre el 100% de lo que corre esta semana. Default.
 *  - `anio`   el resto del año en curso — el pipeline completo.
 *
 *  OJO: el corte es por fecha de PROMESA, no de proceso. El piso trabaja con
 *  anticipacion (solo el 14.6% de lo que corre esta semana se embarca esta
 *  semana), asi que acotar a "la semana actual" esconderia el 85% del trabajo en
 *  curso. Por eso el preset mas corto es 4 semanas y no una.
 */
export type Alcance = "pastdue" | "4sem" | "3meses" | "anio";

export const ALCANCES: { id: Alcance; label: string; ayuda: string }[] = [
  { id: "pastdue", label: "Past-due", ayuda: "Solo lo ya vencido" },
  { id: "4sem", label: "4 semanas", ayuda: "Cubre el 95% de lo que el piso corre esta semana" },
  { id: "3meses", label: "3 meses", ayuda: "Cubre el 100% de lo que corre esta semana" },
  { id: "anio", label: "Todo el año", ayuda: "Hasta el 31 de diciembre" },
];

/** Traduce el alcance a los parametros que entiende la API (`ventana` en meses y
 *  `fecha_max`). El SQL usa `ISNULL(@fecha_max, @techo)`, asi que cuando hay
 *  fecha_max esa manda y `ventana` es inerte. */
export function paramsDeAlcance(a: Alcance): { ventana: number; fechaMax: string } {
  const hoy = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  switch (a) {
    case "pastdue": {
      const ayer = new Date(hoy);
      ayer.setDate(ayer.getDate() - 1);
      return { ventana: 1, fechaMax: iso(ayer) };
    }
    case "4sem": {
      const d = new Date(hoy);
      d.setDate(d.getDate() + 28);
      return { ventana: 1, fechaMax: iso(d) };
    }
    case "3meses":
      return { ventana: 3, fechaMax: "" };
    case "anio":
      return { ventana: 12, fechaMax: iso(new Date(hoy.getFullYear(), 11, 31)) };
  }
}

export interface UiFilters {
  clienteIds: number[];        // [] = todos los clientes. Multi-select.
  ciudadIds: number[];         // [] = todas las ciudades. Multi-select.
  ptIds: number[];             // [] = todos los numeros de parte. Multi-select (idMaterial).
  // Derivado de `alcance` — ya NO es editable a mano. Se conserva en filters
  // porque es lo que viaja a la API y a las queryKeys.
  fechaMax: string;            // ISO yyyy-mm-dd; "" = sin techo extra
  plantaId: number | null;     // null = todas las plantas
  tipoMaterialIds: number[];   // [] = sin filtro (PT + Intermedio). PT=1, Intermedio=3.
  claseIds: number[];          // [] = sin filtro. Aplica solo a Resumen (Q_bloques / Q_pts_en_proceso).
}

export interface ProcesoFiltro {
  idProceso: number;
  nombre: string;
  // Planta de la tarjeta desde la que se hizo drill-down. Acota el listado de
  // PTs a ese proceso EN esa planta. null = sin planta (no deberia pasar desde
  // las tarjetas, que ahora siempre tienen planta).
  idPlanta: number | null;
  nombrePlanta: string | null;
}

export interface BloqueDetalleOpen {
  idProceso: number;
  nombreProceso: string;
  bucket: BloqueBucket;
  // Planta de la tarjeta de origen. Acota el detalle de etiquetas a esa planta.
  // undefined/null = sin filtro de planta (ej. detalle desde una arista del Flujo).
  idPlanta?: number | null;
  // Solo para el detalle de una arista del Flujo (bucket=PorTransferir):
  // acota al proceso destino. null/undefined = todas las salidas del proceso.
  destino?: number | null;
  // Etiqueta opcional para el header del drawer (ej. "Corte → Doblez").
  tituloDestino?: string | null;
}

/**
 * Celda del calendario seleccionada (popover de detalle). null = ninguna
 * abierta. `tipo` decide qué detalle se consulta: "requerimiento" -> órdenes de
 * venta (lado derecho); "embarque" -> líneas de remisión (lado izquierdo).
 */
export interface CeldaDetalleOpen {
  tipo: "requerimiento" | "embarque";
  idMaterial: number;
  PT: string;
  idCliente: number | null;
  Cliente: string;
  idCiudad: number | null;
  Ciudad: string;
  // Limites del bucket (ISO yyyy-mm-dd). `desde` inclusivo, `hasta` EXCLUSIVO.
  // desde=null => columna past-due (todo lo anterior a `hasta` = hoy).
  desde: string | null;
  hasta: string | null;
  // Rotulo del header del popover (ej. "Sem del 28 jul" o "Past-due").
  etiqueta: string;
}

/**
 * Vista activa:
 *   "summary" — pestaña fija "Resumen" con bloques por proceso
 *   "tree"    — un PT abierto (activeTabId) con su arbol netteado
 */
export type ViewKind = "summary" | "tree";

interface UiStore {
  // Vista activa (tab fija "Resumen" o un PT)
  view: ViewKind;

  // Tabs / seleccion
  selectedPtIds: number[];           // orden = orden de tabs
  activeTabId: number | null;
  // Alcance temporal activo. `ventana` y `filters.fechaMax` se DERIVAN de el via
  // paramsDeAlcance y no se setean por separado.
  alcance: Alcance;
  ventana: number;                   // meses de ventana (derivado de `alcance`)

  // Filtro por proceso (drill-down desde Resumen). null = sin filtro.
  procesoFiltro: ProcesoFiltro | null;

  // Metrica activa del drill-down (Disponibles / Recibidas / Por transferir).
  // Determina el badge mostrado en cada PT y el criterio de orden de la lista.
  drilldownMetric: DrilldownMetric;

  // Drawer lateral derecho con el detalle de etiquetas de un bucket de un
  // bloque del Resumen. null = cerrado.
  bloqueDetalle: BloqueDetalleOpen | null;

  // Universo de PTs activo (pestana del sidebar). Acota listado + bloques + flujo.
  universo: Universo;

  // Modo de la vista Resumen: tarjetas sueltas o grafo de flujo conectado.
  resumenMode: ResumenMode;

  // Drill-in del modo Flujo: null = overview de plantas; si hay planta, se
  // muestra el grafo interno de procesos de esa planta.
  flujoPlantaDrill: { idPlanta: number; nombre: string } | null;

  // Nombres de proceso resaltados en el grafo de Flujo (selector multi-nodo, no
  // filtro): resalta todos los nodos con ese nombre (todas sus fases). [] = nada.
  flujoResaltados: string[];

  // Plantas con su seccion colapsada en la vista Resumen (tarjetas). Default:
  // todas expandidas (set vacio). Guarda idPlanta de las plantas colapsadas.
  plantasColapsadas: Set<number>;

  // ---- Vista Calendario de requerimiento (panel expandible del sidebar) ----
  // Tercer estado de ancho del sidebar: false = lista normal (badges), true =
  // matriz calendario. Colapsar la lista (boton "<") es un estado visual aparte.
  sidebarExpanded: boolean;
  calGranularidad: CalGranularidad;  // eje de tiempo (default "semana")
  calIncluyeForecast: boolean;       // false = solo firme (bForecast=0)
  // Modo del panel. Corte 1 solo "requerimiento"; "embarques"/"ambos" reservados
  // para la fase 2 (historial de embarques). Se deja en el store para no
  // rehacer la firma cuando llegue.
  calModo: CalModo;
  celdaDetalle: CeldaDetalleOpen | null;

  // Modo de visualizacion y filtros del sidebar (client-side)
  mode: Mode;
  expanded: Set<number>;             // idComp expandidos en el canvas
  filters: UiFilters;

  // Mutadores
  showSummary: () => void;
  togglePt: (idPt: number) => void;
  closeTab: (idPt: number) => void;
  setActiveTab: (idPt: number | null) => void;
  setMode: (mode: Mode) => void;
  toggleExpanded: (idComp: number) => void;
  setExpanded: (ids: Iterable<number>) => void;
  setFilter: <K extends keyof UiFilters>(key: K, value: UiFilters[K]) => void;
  setVentana: (v: number) => void;
  setProcesoFiltro: (p: ProcesoFiltro | null) => void;
  setDrilldownMetric: (m: DrilldownMetric) => void;
  setBloqueDetalle: (d: BloqueDetalleOpen | null) => void;
  setUniverso: (u: Universo) => void;
  setResumenMode: (m: ResumenMode) => void;
  setFlujoPlantaDrill: (p: { idPlanta: number; nombre: string } | null) => void;
  setFlujoResaltados: (names: string[]) => void;
  togglePlantaColapsada: (idPlanta: number) => void;
  setSidebarExpanded: (v: boolean) => void;
  toggleSidebarExpanded: () => void;
  setCalGranularidad: (g: CalGranularidad) => void;
  setCalIncluyeForecast: (v: boolean) => void;
  setCalModo: (m: CalModo) => void;
  setCeldaDetalle: (c: CeldaDetalleOpen | null) => void;
  setAlcance: (a: Alcance) => void;
  clearSelection: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  view: "summary",
  selectedPtIds: [],
  activeTabId: null,
  alcance: "3meses",
  ventana: 3,
  procesoFiltro: null,
  drilldownMetric: "disponibles",
  bloqueDetalle: null,

  universo: "general",
  resumenMode: "cards",
  flujoPlantaDrill: null,
  flujoResaltados: [],
  plantasColapsadas: new Set(),

  sidebarExpanded: false,
  calGranularidad: "semana",
  calIncluyeForecast: false,
  calModo: "ambos",
  celdaDetalle: null,

  mode: "inventario",
  expanded: new Set(),
  filters: {
    clienteIds: [],
    ciudadIds: [],
    ptIds: [],
    fechaMax: "",
    plantaId: null,
    tipoMaterialIds: [],
    claseIds: [],
  },

  showSummary: () => set({ view: "summary", activeTabId: null }),

  togglePt: (idPt) =>
    set((s) => {
      if (s.selectedPtIds.includes(idPt)) {
        // Si ya esta seleccionado, lo quitamos (se cierra el tab).
        const next = s.selectedPtIds.filter((id) => id !== idPt);
        const nextActive =
          s.activeTabId === idPt ? next[next.length - 1] ?? null : s.activeTabId;
        return {
          selectedPtIds: next,
          activeTabId: nextActive,
          view: nextActive === null ? "summary" : "tree",
        };
      }
      return {
        selectedPtIds: [...s.selectedPtIds, idPt],
        activeTabId: idPt,
        view: "tree",
      };
    }),

  closeTab: (idPt) =>
    set((s) => {
      const next = s.selectedPtIds.filter((id) => id !== idPt);
      const nextActive =
        s.activeTabId === idPt ? next[next.length - 1] ?? null : s.activeTabId;
      return {
        selectedPtIds: next,
        activeTabId: nextActive,
        view: nextActive === null ? "summary" : "tree",
      };
    }),

  setActiveTab: (idPt) =>
    set(() => ({
      activeTabId: idPt,
      view: idPt === null ? "summary" : "tree",
    })),

  setMode: (mode) => set({ mode }),

  toggleExpanded: (idComp) =>
    set((s) => {
      const next = new Set(s.expanded);
      if (next.has(idComp)) next.delete(idComp);
      else next.add(idComp);
      return { expanded: next };
    }),

  setExpanded: (ids) => set({ expanded: new Set(ids) }),

  setFilter: (key, value) =>
    set((s) => ({ filters: { ...s.filters, [key]: value } })),

  setVentana: (v) => set({ ventana: v }),

  // Cambiar el alcance reescribe ventana Y fechaMax a la vez: son dos caras del
  // mismo corte y separarlas fue lo que permitia estados incoherentes.
  setAlcance: (a) =>
    set((s) => {
      const { ventana, fechaMax } = paramsDeAlcance(a);
      return { alcance: a, ventana, filters: { ...s.filters, fechaMax } };
    }),
  setProcesoFiltro: (p) => set({ procesoFiltro: p }),
  setDrilldownMetric: (m) => set({ drilldownMetric: m }),
  setBloqueDetalle: (d) => set({ bloqueDetalle: d }),
  setUniverso: (u) =>
    // Cambiar de universo invalida el drill-down por proceso (otro set de PTs)
    // y el drill-in de planta del Flujo (otro set de plantas).
    set({ universo: u, procesoFiltro: null, flujoPlantaDrill: null, flujoResaltados: [] }),
  setResumenMode: (m) =>
    // Cada vez que se entra/sale del modo Flujo se arranca en el overview.
    set({ resumenMode: m, flujoPlantaDrill: null, flujoResaltados: [] }),
  // Cambiar de planta cambia el set de procesos -> limpiar resaltados.
  setFlujoPlantaDrill: (p) => set({ flujoPlantaDrill: p, flujoResaltados: [] }),
  setFlujoResaltados: (names) => set({ flujoResaltados: names }),
  togglePlantaColapsada: (idPlanta) =>
    set((s) => {
      const next = new Set(s.plantasColapsadas);
      if (next.has(idPlanta)) next.delete(idPlanta);
      else next.add(idPlanta);
      return { plantasColapsadas: next };
    }),
  setSidebarExpanded: (v) => set({ sidebarExpanded: v }),
  // Al cerrar el panel se cierra tambien el popover de detalle abierto.
  toggleSidebarExpanded: () =>
    set((s) => ({
      sidebarExpanded: !s.sidebarExpanded,
      celdaDetalle: s.sidebarExpanded ? null : s.celdaDetalle,
    })),
  setCalGranularidad: (g) => set({ calGranularidad: g, celdaDetalle: null }),
  setCalIncluyeForecast: (v) => set({ calIncluyeForecast: v, celdaDetalle: null }),
  setCalModo: (m) => set({ calModo: m }),
  setCeldaDetalle: (c) => set({ celdaDetalle: c }),
  clearSelection: () => set({ selectedPtIds: [], activeTabId: null, view: "summary" }),
}));
