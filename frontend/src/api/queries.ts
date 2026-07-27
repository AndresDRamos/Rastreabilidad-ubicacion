import { useQuery } from "@tanstack/react-query";

import { apiClient } from "./client";
import type {
  ArbolPT,
  BloqueBucket,
  BloqueProceso,
  CeldaCalendario,
  CeldaEmbarque,
  EtiquetaDetalle,
  FilaListado,
  FlujoPlantasResponse,
  FlujoResponse,
  OrdenLinea,
  Planta,
  PTEnProceso,
  RemisionLinea,
  Universo,
} from "./types";

export function usePts(
  ventana: number = 3,
  fechaMax: string = "",
  universo: Universo = "general",
) {
  const fechaMaxParam = fechaMax || undefined;
  return useQuery<FilaListado[]>({
    queryKey: ["pts", universo, ventana, fechaMaxParam ?? null],
    queryFn: async () => {
      const params: Record<string, string | number> = { ventana };
      if (fechaMaxParam) params.fecha_max = fechaMaxParam;
      if (universo !== "general") params.universo = universo;
      const { data } = await apiClient.get<FilaListado[]>("/pts", { params });
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
  clienteIds: number[] = [],
  planta: number | null = null,
  ciudadIds: number[] = [],
  tipoMaterialIds: number[] = [],
  claseIds: number[] = [],
  universo: Universo = "general",
) {
  const clientesKey = idsCsv(clienteIds) ?? "";
  const ciudadesKey = ciudadesCsv(ciudadIds) ?? "";
  const tiposKey = idsCsv(tipoMaterialIds) ?? "";
  const clasesKey = idsCsv(claseIds) ?? "";
  return useQuery<BloqueProceso[]>({
    queryKey: [
      "bloques",
      universo,
      clientesKey,
      planta,
      ciudadesKey,
      tiposKey,
      clasesKey,
    ],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      const clientes = idsCsv(clienteIds);
      if (clientes) params.clientes = clientes;
      if (planta != null) params.planta = planta;
      const ciud = ciudadesCsv(ciudadIds);
      if (ciud) params.ciudades = ciud;
      const tipos = idsCsv(tipoMaterialIds);
      if (tipos) params.tipos_material = tipos;
      const clases = idsCsv(claseIds);
      if (clases) params.clases = clases;
      if (universo !== "general") params.universo = universo;
      const { data } = await apiClient.get<BloqueProceso[]>("/bloques", {
        params,
      });
      return data;
    },
    staleTime: 2 * 60 * 1000, // 2 min — coincide con TTL del backend
  });
}

export function useFlujo(
  clienteIds: number[] = [],
  planta: number | null = null,
  ciudadIds: number[] = [],
  tipoMaterialIds: number[] = [],
  claseIds: number[] = [],
  universo: Universo = "general",
) {
  const clientesKey = idsCsv(clienteIds) ?? "";
  const ciudadesKey = ciudadesCsv(ciudadIds) ?? "";
  const tiposKey = idsCsv(tipoMaterialIds) ?? "";
  const clasesKey = idsCsv(claseIds) ?? "";
  return useQuery<FlujoResponse>({
    queryKey: [
      "flujo",
      universo,
      clientesKey,
      planta,
      ciudadesKey,
      tiposKey,
      clasesKey,
    ],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      const clientes = idsCsv(clienteIds);
      if (clientes) params.clientes = clientes;
      if (planta != null) params.planta = planta;
      const ciud = ciudadesCsv(ciudadIds);
      if (ciud) params.ciudades = ciud;
      const tipos = idsCsv(tipoMaterialIds);
      if (tipos) params.tipos_material = tipos;
      const clases = idsCsv(claseIds);
      if (clases) params.clases = clases;
      if (universo !== "general") params.universo = universo;
      const { data } = await apiClient.get<FlujoResponse>("/flujo", { params });
      return data;
    },
    staleTime: 2 * 60 * 1000, // 2 min — coincide con TTL del backend
  });
}

export function useFlujoPlantas(
  clienteIds: number[] = [],
  ciudadIds: number[] = [],
  tipoMaterialIds: number[] = [],
  claseIds: number[] = [],
  universo: Universo = "general",
) {
  const clientesKey = idsCsv(clienteIds) ?? "";
  const ciudadesKey = ciudadesCsv(ciudadIds) ?? "";
  const tiposKey = idsCsv(tipoMaterialIds) ?? "";
  const clasesKey = idsCsv(claseIds) ?? "";
  return useQuery<FlujoPlantasResponse>({
    queryKey: [
      "flujo-plantas",
      universo,
      clientesKey,
      ciudadesKey,
      tiposKey,
      clasesKey,
    ],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      const clientes = idsCsv(clienteIds);
      if (clientes) params.clientes = clientes;
      const ciud = ciudadesCsv(ciudadIds);
      if (ciud) params.ciudades = ciud;
      const tipos = idsCsv(tipoMaterialIds);
      if (tipos) params.tipos_material = tipos;
      const clases = idsCsv(claseIds);
      if (clases) params.clases = clases;
      if (universo !== "general") params.universo = universo;
      const { data } = await apiClient.get<FlujoPlantasResponse>(
        "/flujo/plantas",
        { params },
      );
      return data;
    },
    staleTime: 2 * 60 * 1000, // 2 min — coincide con TTL del backend
  });
}

export function usePtsEnProceso(
  idProceso: number | null,
  clienteIds: number[] = [],
  planta: number | null = null,
  ciudadIds: number[] = [],
  tipoMaterialIds: number[] = [],
  claseIds: number[] = [],
  universo: Universo = "general",
) {
  const clientesKey = idsCsv(clienteIds) ?? "";
  const ciudadesKey = ciudadesCsv(ciudadIds) ?? "";
  const tiposKey = idsCsv(tipoMaterialIds) ?? "";
  const clasesKey = idsCsv(claseIds) ?? "";
  return useQuery<PTEnProceso[]>({
    queryKey: [
      "pts-en-proceso",
      universo,
      idProceso,
      clientesKey,
      planta,
      ciudadesKey,
      tiposKey,
      clasesKey,
    ],
    enabled: idProceso !== null,
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      const clientes = idsCsv(clienteIds);
      if (clientes) params.clientes = clientes;
      if (planta != null) params.planta = planta;
      const ciud = ciudadesCsv(ciudadIds);
      if (ciud) params.ciudades = ciud;
      const tipos = idsCsv(tipoMaterialIds);
      if (tipos) params.tipos_material = tipos;
      const clases = idsCsv(claseIds);
      if (clases) params.clases = clases;
      if (universo !== "general") params.universo = universo;
      const { data } = await apiClient.get<PTEnProceso[]>(
        `/bloques/${idProceso}/pts`,
        { params },
      );
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useEtiquetasDetalle(
  idProceso: number | null,
  bucket: BloqueBucket | null,
  clienteIds: number[] = [],
  planta: number | null = null,
  ciudadIds: number[] = [],
  tipoMaterialIds: number[] = [],
  claseIds: number[] = [],
  universo: Universo = "general",
  destino: number | null = null,
) {
  const clientesKey = idsCsv(clienteIds) ?? "";
  const ciudadesKey = ciudadesCsv(ciudadIds) ?? "";
  const tiposKey = idsCsv(tipoMaterialIds) ?? "";
  const clasesKey = idsCsv(claseIds) ?? "";
  return useQuery<EtiquetaDetalle[]>({
    queryKey: [
      "etiquetas-detalle",
      universo,
      idProceso,
      bucket,
      destino,
      clientesKey,
      planta,
      ciudadesKey,
      tiposKey,
      clasesKey,
    ],
    enabled: idProceso !== null && bucket !== null,
    queryFn: async () => {
      const params: Record<string, string | number> = { bucket: bucket! };
      const clientes = idsCsv(clienteIds);
      if (clientes) params.clientes = clientes;
      if (planta != null) params.planta = planta;
      const ciud = ciudadesCsv(ciudadIds);
      if (ciud) params.ciudades = ciud;
      const tipos = idsCsv(tipoMaterialIds);
      if (tipos) params.tipos_material = tipos;
      const clases = idsCsv(claseIds);
      if (clases) params.clases = clases;
      if (universo !== "general") params.universo = universo;
      if (
        destino != null &&
        (bucket === "PorTransferir" || bucket === "Encaminadas")
      )
        params.destino = destino;
      const { data } = await apiClient.get<EtiquetaDetalle[]>(
        `/bloques/${idProceso}/etiquetas`,
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

// Calendario de requerimiento (panel expandible). Igual que usePts: los mismos
// params server-side (universo, ventana, fechaMax). Cliente/ciudad/forecast/
// granularidad se resuelven client-side sobre el result-set, sin re-fetch.
export function useRequerimientoCalendario(
  ventana: number = 3,
  fechaMax: string = "",
  universo: Universo = "general",
) {
  const fechaMaxParam = fechaMax || undefined;
  return useQuery<CeldaCalendario[]>({
    queryKey: ["requerimiento-cal", universo, ventana, fechaMaxParam ?? null],
    queryFn: async () => {
      const params: Record<string, string | number> = { ventana };
      if (fechaMaxParam) params.fecha_max = fechaMaxParam;
      if (universo !== "general") params.universo = universo;
      const { data } = await apiClient.get<CeldaCalendario[]>(
        "/requerimiento/calendario",
        { params },
      );
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 min — espeja TTL backend (como /pts)
  });
}

// Detalle de una celda del calendario: lineas de orden de venta. desde=null =>
// columna past-due (todo lo anterior a hasta). Solo corre con idMaterial != null.
export function useOrdenDetalle(
  idMaterial: number | null,
  cliente: number | null = null,
  ciudad: number | null = null,
  desde: string | null = null,
  hasta: string | null = null,
  forecast: boolean = false,
) {
  return useQuery<OrdenLinea[]>({
    queryKey: [
      "orden-detalle",
      idMaterial,
      cliente,
      ciudad,
      desde,
      hasta,
      forecast,
    ],
    enabled: idMaterial !== null,
    queryFn: async () => {
      const params: Record<string, string | number | boolean> = {
        idMaterial: idMaterial!,
      };
      if (cliente != null) params.cliente = cliente;
      if (ciudad != null) params.ciudad = ciudad;
      if (desde) params.desde = desde;
      if (hasta) params.hasta = hasta;
      if (forecast) params.forecast = true;
      const { data } = await apiClient.get<OrdenLinea[]>(
        "/requerimiento/orden-detalle",
        { params },
      );
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

// Historial de embarques (fase 2 del calendario). Igual que useRequerimientoCalendario:
// los mismos params server-side (universo, meses_atras). Cliente/ciudad/pt/
// granularidad se resuelven client-side sobre el result-set, sin re-fetch.
export function useEmbarquesCalendario(
  mesesAtras: number = 12,
  universo: Universo = "general",
) {
  return useQuery<CeldaEmbarque[]>({
    queryKey: ["embarques-cal", universo, mesesAtras],
    queryFn: async () => {
      const params: Record<string, string | number> = { meses_atras: mesesAtras };
      if (universo !== "general") params.universo = universo;
      const { data } = await apiClient.get<CeldaEmbarque[]>(
        "/requerimiento/embarques",
        { params },
      );
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 min — espeja TTL backend (como /calendario)
  });
}

// Detalle de una celda de embarque: lineas de remision. desde=null => sin piso
// inferior (todo lo anterior a hasta). Solo corre con idMaterial != null.
export function useRemisionDetalle(
  idMaterial: number | null,
  cliente: number | null = null,
  ciudad: number | null = null,
  desde: string | null = null,
  hasta: string | null = null,
) {
  return useQuery<RemisionLinea[]>({
    queryKey: ["remision-detalle", idMaterial, cliente, ciudad, desde, hasta],
    enabled: idMaterial !== null,
    queryFn: async () => {
      const params: Record<string, string | number> = { idMaterial: idMaterial! };
      if (cliente != null) params.cliente = cliente;
      if (ciudad != null) params.ciudad = ciudad;
      if (desde) params.desde = desde;
      if (hasta) params.hasta = hasta;
      const { data } = await apiClient.get<RemisionLinea[]>(
        "/requerimiento/remision-detalle",
        { params },
      );
      return data;
    },
    staleTime: 2 * 60 * 1000,
  });
}
