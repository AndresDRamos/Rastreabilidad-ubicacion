import { create } from "zustand";

import type { Mode } from "@/api/types";

export interface UiFilters {
  cliente: string;
  ciudad: string;
  pt: string;
  fechaMax: string; // ISO yyyy-mm-dd; "" = sin filtro
}

interface UiStore {
  // Tabs / seleccion
  selectedPtIds: number[];           // orden = orden de tabs
  activeTabId: number | null;
  ventana: number;                   // meses de ventana (default 3)

  // Modo de visualizacion y filtros del sidebar (client-side)
  mode: Mode;
  expanded: Set<number>;             // idComp expandidos en el canvas
  filters: UiFilters;

  // Mutadores
  togglePt: (idPt: number) => void;
  closeTab: (idPt: number) => void;
  setActiveTab: (idPt: number | null) => void;
  setMode: (mode: Mode) => void;
  toggleExpanded: (idComp: number) => void;
  setExpanded: (ids: Iterable<number>) => void;
  setFilter: (key: keyof UiFilters, value: string) => void;
  setVentana: (v: number) => void;
  clearSelection: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  selectedPtIds: [],
  activeTabId: null,
  ventana: 3,

  mode: "requerimiento",
  expanded: new Set(),
  filters: { cliente: "", ciudad: "", pt: "", fechaMax: "" },

  togglePt: (idPt) =>
    set((s) => {
      if (s.selectedPtIds.includes(idPt)) {
        // Si ya esta seleccionado, lo quitamos (se cierra el tab).
        const next = s.selectedPtIds.filter((id) => id !== idPt);
        const nextActive =
          s.activeTabId === idPt ? next[next.length - 1] ?? null : s.activeTabId;
        return { selectedPtIds: next, activeTabId: nextActive };
      }
      return {
        selectedPtIds: [...s.selectedPtIds, idPt],
        activeTabId: idPt,
      };
    }),

  closeTab: (idPt) =>
    set((s) => {
      const next = s.selectedPtIds.filter((id) => id !== idPt);
      const nextActive =
        s.activeTabId === idPt ? next[next.length - 1] ?? null : s.activeTabId;
      return { selectedPtIds: next, activeTabId: nextActive };
    }),

  setActiveTab: (idPt) => set({ activeTabId: idPt }),
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
  clearSelection: () => set({ selectedPtIds: [], activeTabId: null }),
}));
