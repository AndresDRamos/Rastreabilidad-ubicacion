import { create } from "zustand";

import type { Mode } from "@/api/types";

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
  clearSelection: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  view: "summary",
  selectedPtIds: [],
  activeTabId: null,
  ventana: 3,
  procesoFiltro: null,

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
  clearSelection: () => set({ selectedPtIds: [], activeTabId: null, view: "summary" }),
}));
