import { useQuery } from "@tanstack/react-query";

import { apiClient } from "./client";
import type {
  ArbolPT,
  BloqueProceso,
  FilaListado,
  Planta,
  PTEnProceso,
} from "./types";

export function usePts(ventana: number = 3, fechaMax: string = "") {
  const fechaMaxParam = fechaMax || undefined;
  return useQuery<FilaListado[]>({
    queryKey: ["pts", ventana, fechaMaxParam ?? null],
    queryFn: async () => {
      const { data } = await apiClient.get<FilaListado[]>("/pts", {
        params: { ventana, fecha_max: fechaMaxParam },
      });
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 min — coincide con el TTL del backend
  });
}

export function useArbol(
  idPt: number | null,
  ventana: number = 3,
  fechaMax: string = "",
) {
  const fechaMaxParam = fechaMax || undefined;
  return useQuery<ArbolPT>({
    queryKey: ["arbol", idPt, ventana, fechaMaxParam ?? null],
    enabled: idPt !== null,
    queryFn: async () => {
      const { data } = await apiClient.get<ArbolPT>(`/pts/${idPt}/arbol`, {
        params: { ventana, fecha_max: fechaMaxParam },
      });
      return data;
    },
    // Cache infinito durante la sesion: un PT pesado solo se descarga una vez
    // por combinacion (idPt, ventana, fechaMax).
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

function idsCsv(ids: number[] | undefined): string | undefined {
  if (!ids || ids.length === 0) return undefined;
  return ids.join(",");
}

// Alias retro-compatible
const ciudadesCsv = idsCsv;

export function useBloques(
  cliente: number | null = null,
  planta: number | null = null,
  ciudadIds: number[] = [],
  tipoMaterialIds: number[] = [],
) {
  const ciudadesKey = ciudadesCsv(ciudadIds) ?? "";
  const tiposKey = idsCsv(tipoMaterialIds) ?? "";
  return useQuery<BloqueProceso[]>({
    queryKey: ["bloques", cliente, planta, ciudadesKey, tiposKey],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (cliente != null) params.cliente = cliente;
      if (planta != null) params.planta = planta;
      const ciud = ciudadesCsv(ciudadIds);
      if (ciud) params.ciudades = ciud;
      const tipos = idsCsv(tipoMaterialIds);
      if (tipos) params.tipos_material = tipos;
      const { data } = await apiClient.get<BloqueProceso[]>("/bloques", {
        params,
      });
      return data;
    },
    staleTime: 2 * 60 * 1000, // 2 min — coincide con TTL del backend
  });
}

export function usePtsEnProceso(
  idProceso: number | null,
  cliente: number | null = null,
  planta: number | null = null,
  ciudadIds: number[] = [],
  tipoMaterialIds: number[] = [],
) {
  const ciudadesKey = ciudadesCsv(ciudadIds) ?? "";
  const tiposKey = idsCsv(tipoMaterialIds) ?? "";
  return useQuery<PTEnProceso[]>({
    queryKey: [
      "pts-en-proceso",
      idProceso,
      cliente,
      planta,
      ciudadesKey,
      tiposKey,
    ],
    enabled: idProceso !== null,
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (cliente != null) params.cliente = cliente;
      if (planta != null) params.planta = planta;
      const ciud = ciudadesCsv(ciudadIds);
      if (ciud) params.ciudades = ciud;
      const tipos = idsCsv(tipoMaterialIds);
      if (tipos) params.tipos_material = tipos;
      const { data } = await apiClient.get<PTEnProceso[]>(
        `/bloques/${idProceso}/pts`,
        { params },
      );
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function usePlantas() {
  return useQuery<Planta[]>({
    queryKey: ["plantas"],
    queryFn: async () => {
      const { data } = await apiClient.get<Planta[]>("/plantas");
      return data;
    },
    staleTime: 10 * 60 * 1000, // las plantas no cambian seguido
  });
}
