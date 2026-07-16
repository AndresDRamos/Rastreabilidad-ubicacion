import { create } from "zustand";

import type {
  BloqueBucket,
  DrilldownMetric,
  Mode,
  ResumenMode,
  Universo,
} from "@/api/types";

export interface UiFilters {
  clienteId: number | null;    // null = sin filtro (todos los clientes)
  ciudadIds: number[];         // [] = todas las ciudades. Multi-select.
  pt: string;                  // busqueda parcial client-side
  fechaMax: string;            // ISO yyyy-mm-dd; "" = sin filtro
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
  ventana: number;                   // meses de ventana (default 3)

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
  clearSelection: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  view: "summary",
  selectedPtIds: [],
  activeTabId: null,
  ventana: 3,
  procesoFiltro: null,
  drilldownMetric: "disponibles",
  bloqueDetalle: null,

  universo: "general",
  resumenMode: "cards",
  flujoPlantaDrill: null,
  flujoResaltados: [],
  plantasColapsadas: new Set(),

  mode: "inventario",
  expanded: new Set(),
  filters: {
    clienteId: null,
    ciudadIds: [],
    pt: "",
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
  clearSelection: () => set({ selectedPtIds: [], activeTabId: null, view: "summary" }),
}));
