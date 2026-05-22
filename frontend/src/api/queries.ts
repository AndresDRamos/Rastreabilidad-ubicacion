import { useQuery } from "@tanstack/react-query";

import { apiClient } from "./client";
import type { ArbolPT, FilaListado } from "./types";

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

export function useArbol(idPt: number | null, ventana: number = 3) {
  return useQuery<ArbolPT>({
    queryKey: ["arbol", idPt, ventana],
    enabled: idPt !== null,
    queryFn: async () => {
      const { data } = await apiClient.get<ArbolPT>(`/pts/${idPt}/arbol`, {
        params: { ventana },
      });
      return data;
    },
    // Cache infinito durante la sesion: un PT pesado solo se descarga una vez.
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
