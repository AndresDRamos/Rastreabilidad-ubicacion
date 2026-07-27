import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import {
  useEmbarquesCalendario,
  useOrdenDetalle,
  useRemisionDetalle,
  useRequerimientoCalendario,
} from "@/api/queries";
import type {
  CalGranularidad,
  CalModo,
  CeldaCalendario,
  CeldaEmbarque,
} from "@/api/types";
import { PartThumbnail } from "@/components/Canvas/nodes/PartThumbnail";
import { Skeleton } from "@/components/ui/Skeleton";
import { useUiStore } from "@/store/useUiStore";

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

// Historico de embarques hacia atras: mismo default que el backend (@meses_atras).
const MESES_ATRAS = 12;

const nfInt = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const nfMoney = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function fmtInt(n: number): string {
  return nfInt.format(Math.round(n));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---- Fechas (parse local para no correr por timezone) ----------------------

function parseISO(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function startOfWeek(d: Date): Date {
  // Lunes como inicio de semana.
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  return addDays(d, -dow);
}

function hoyLocal(): Date {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

// Inicio del bucket que contiene `d` para la granularidad dada.
function bucketStart(d: Date, g: CalGranularidad): Date {
  if (g === "dia") return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (g === "semana") return startOfWeek(d);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function bucketNext(start: Date, g: CalGranularidad): Date {
  if (g === "dia") return addDays(start, 1);
  if (g === "semana") return addDays(start, 7);
  return addMonths(start, 1);
}

function bucketPrev(start: Date, g: CalGranularidad): Date {
  if (g === "dia") return addDays(start, -1);
  if (g === "semana") return addDays(start, -7);
  return addMonths(start, -1);
}

function bucketKey(start: Date): string {
  return isoDay(start);
}

// Numero de semana ISO-8601 (semana que contiene al primer jueves del anio).
function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // lunes = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // jueves de esta semana
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

function fmtDiaMes(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")} ${MESES[d.getMonth()]}`;
}

// `nextExcl` = limite superior EXCLUSIVO del bucket (para calcular el fin real
// de la semana: nextExcl - 1 dia).
function bucketLabel(
  start: Date,
  nextExcl: Date,
  g: CalGranularidad,
): { top: string; sub: string } {
  if (g === "mes") {
    const mmm = MESES[start.getMonth()];
    return { top: mmm, sub: `'${String(start.getFullYear()).slice(2)}` };
  }
  if (g === "semana") {
    const fin = addDays(nextExcl, -1);
    return { top: `Sem ${isoWeekNumber(start)}`, sub: `${fmtDiaMes(start)} - ${fmtDiaMes(fin)}` };
  }
  return { top: fmtDiaMes(start), sub: "" };
}

// ---- Color del heatmap -----------------------------------------------------

type RGB = [number, number, number];
const NEAR: RGB = [216, 90, 48]; // coral (urgente / cercano) — requerimiento
const FAR: RGB = [29, 158, 117]; // teal (lejano) — requerimiento
const PASTDUE: RGB = [226, 75, 74]; // rojo
const EMB: RGB = [37, 99, 235]; // azul (embarcado / histórico)

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function rgba([r, g, b]: RGB, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Blend sobre blanco -> color solido (para cabeceras/celdas que deben ser opacas).
function blendOnWhite([r, g, b]: RGB, a: number): string {
  const mixCh = (c: number) => Math.round(255 * (1 - a) + c * a);
  return `rgb(${mixCh(r)}, ${mixCh(g)}, ${mixCh(b)})`;
}

const HATCH =
  "repeating-linear-gradient(45deg, rgba(255,255,255,0.5) 0 3px, transparent 3px 6px)";

// Contorno de la columna "hoy" (dia/semana/mes actual).
const HOY_COLOR = "#3b82f6";
function hoyColStyle(isHoy: boolean, edge: "top" | "middle" | "bottom"): CSSProperties {
  if (!isHoy) return {};
  return {
    borderLeft: `2px solid ${HOY_COLOR}`,
    borderRight: `2px solid ${HOY_COLOR}`,
    borderTop: edge === "top" ? `2px solid ${HOY_COLOR}` : undefined,
    borderBottom: edge === "bottom" ? `2px solid ${HOY_COLOR}` : undefined,
  };
}

// ---- Modelo derivado -------------------------------------------------------

interface FilaCal {
  key: string;
  idMaterial: number;
  PT: string;
  descripcion: string;
  idCliente: number | null;
  cliente: string;
  idCiudad: number | null;
  ciudad: string;
  pastDue: number;
  // por bucketKey de requerimiento: total y porcion forecast
  buckets: Map<string, { total: number; fc: number }>;
  // por bucketKey de embarque: piezas embarcadas
  bucketsEmb: Map<string, number>;
}

// Una columna del eje temporal unificado: embarque (izq) | presente | req (der).
// "presente" = bucket actual consolidado en franjas apiladas (embarcado /
// past-due / requerimiento). Reemplaza las 3 columnas del "ahora" por una sola.
type ColKind = "emb" | "presente" | "req";
interface Col {
  kind: ColKind;
  key: string;
  desde: string | null; // ISO (emb/req/presente: start del bucket actual)
  hasta: string; // ISO EXCLUSIVO (emb/req/presente: nextExcl)
  label: { top: string; sub: string };
  esHoy: boolean;
  gradT: number; // posicion 0..1 en el eje de requerimiento (gradiente cálido)
}

const COL1_W = 210;
const BUCKET_W = 58;
// Tope de filas renderizadas (sin virtualizar). El universo (PT x Cliente x
// Ciudad) ronda los 3k por lado; renderizarlo entero con celdas sticky cuelga
// el navegador. El usuario acota con los filtros (PT/cliente/ciudad).
const MAX_FILAS = 250;
// La semana necesita mas ancho para el subtitulo "20 jul - 26 jul".
function bucketWidth(g: CalGranularidad): number {
  return g === "semana" ? 88 : BUCKET_W;
}

export function CalendarioPanel() {
  const ventana = useUiStore((s) => s.ventana);
  const universo = useUiStore((s) => s.universo);
  const filters = useUiStore((s) => s.filters);
  const gran = useUiStore((s) => s.calGranularidad);
  const incluyeForecast = useUiStore((s) => s.calIncluyeForecast);
  const setGran = useUiStore((s) => s.setCalGranularidad);
  const setIncluyeForecast = useUiStore((s) => s.setCalIncluyeForecast);
  const modo = useUiStore((s) => s.calModo);
  const setModo = useUiStore((s) => s.setCalModo);
  const celdaDetalle = useUiStore((s) => s.celdaDetalle);
  const setCeldaDetalle = useUiStore((s) => s.setCeldaDetalle);

  const incluyeReq = modo === "requerimiento" || modo === "ambos";
  const incluyeEmb = modo === "embarques" || modo === "ambos";

  const { data: celdas, isLoading: loadingReq, error: errorReq } =
    useRequerimientoCalendario(ventana, filters.fechaMax, universo);
  const { data: embarques, isLoading: loadingEmb, error: errorEmb } =
    useEmbarquesCalendario(MESES_ATRAS, universo);

  const isLoading = (incluyeReq && loadingReq) || (incluyeEmb && loadingEmb);
  const error = (incluyeReq && errorReq) || (incluyeEmb && errorEmb) || null;

  const hoy = useMemo(() => hoyLocal(), []);

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useCallback((node: HTMLDivElement | null) => setScrollEl(node), []);
  const [availWidth, setAvailWidth] = useState(0);
  useEffect(() => {
    if (!scrollEl) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? scrollEl.clientWidth;
      setAvailWidth(w);
    });
    ro.observe(scrollEl);
    setAvailWidth(scrollEl.clientWidth);
    return () => ro.disconnect();
  }, [scrollEl]);

  const [offset, setOffset] = useState(0);

  // Filtrado client-side del requerimiento: pt/cliente/ciudad y forecast.
  const reqFiltradas = useMemo<CeldaCalendario[]>(() => {
    if (!celdas || !incluyeReq) return [];
    const ptSet = filters.ptIds.length ? new Set(filters.ptIds) : null;
    const cliSet = filters.clienteIds.length ? new Set(filters.clienteIds) : null;
    const ciuSet = filters.ciudadIds.length ? new Set(filters.ciudadIds) : null;
    return celdas.filter((c) => {
      if (!incluyeForecast && c.bForecast) return false;
      if (ptSet && !ptSet.has(c.idMaterial)) return false;
      if (cliSet && (c.idCliente == null || !cliSet.has(c.idCliente))) return false;
      if (ciuSet && (c.idCiudad == null || !ciuSet.has(c.idCiudad))) return false;
      return true;
    });
  }, [celdas, incluyeReq, filters.ptIds, filters.clienteIds, filters.ciudadIds, incluyeForecast]);

  // Filtrado client-side de embarques: pt/cliente/ciudad (no hay forecast).
  const embFiltradas = useMemo<CeldaEmbarque[]>(() => {
    if (!embarques || !incluyeEmb) return [];
    const ptSet = filters.ptIds.length ? new Set(filters.ptIds) : null;
    const cliSet = filters.clienteIds.length ? new Set(filters.clienteIds) : null;
    const ciuSet = filters.ciudadIds.length ? new Set(filters.ciudadIds) : null;
    return embarques.filter((c) => {
      if (ptSet && !ptSet.has(c.idMaterial)) return false;
      if (cliSet && (c.idCliente == null || !cliSet.has(c.idCliente))) return false;
      if (ciuSet && (c.idCiudad == null || !ciuSet.has(c.idCiudad))) return false;
      return true;
    });
  }, [embarques, incluyeEmb, filters.ptIds, filters.clienteIds, filters.ciudadIds]);

  // Columnas de requerimiento (buckets desde hoy hasta el ultimo dato futuro).
  const colsReq = useMemo<Col[]>(() => {
    if (!incluyeReq) return [];
    let maxFut: Date | null = null;
    for (const c of reqFiltradas) {
      const f = parseISO(c.Fecha);
      if (f >= hoy && (maxFut === null || f > maxFut)) maxFut = f;
    }
    const cols: Col[] = [];
    if (maxFut === null) return cols;
    // El bucket actual va a la columna "presente" (consolidada) -> arrancamos en
    // el siguiente bucket.
    let cur = bucketNext(bucketStart(hoy, gran), gran);
    const endStart = bucketStart(maxFut, gran);
    let guard = 0;
    while (cur <= endStart && guard < 400) {
      const nextExcl = bucketNext(cur, gran);
      cols.push({
        kind: "req",
        key: bucketKey(cur),
        desde: isoDay(cur),
        hasta: isoDay(nextExcl),
        label: bucketLabel(cur, nextExcl, gran),
        esHoy: false,
        gradT: 0, // se rellena abajo
      });
      cur = nextExcl;
      guard += 1;
    }
    const n = cols.length;
    cols.forEach((c, i) => (c.gradT = n > 1 ? i / (n - 1) : 0));
    return cols;
  }, [reqFiltradas, gran, hoy, incluyeReq]);

  // Columnas de embarque (buckets desde el mas antiguo con datos hasta el actual).
  const colsEmb = useMemo<Col[]>(() => {
    if (!incluyeEmb) return [];
    let minPas: Date | null = null;
    for (const c of embFiltradas) {
      const f = parseISO(c.Fecha);
      if (f <= hoy && (minPas === null || f < minPas)) minPas = f;
    }
    const cols: Col[] = [];
    if (minPas === null) return cols;
    const startFirst = bucketStart(minPas, gran);
    // Si hay columna "presente" (incluyeReq), el bucket actual se consolida ahí
    // -> los embarques arrancan en el bucket anterior. En modo embarques puro el
    // bucket actual es una columna de embarque normal.
    let cur = incluyeReq
      ? bucketPrev(bucketStart(hoy, gran), gran)
      : bucketStart(hoy, gran);
    let guard = 0;
    // Recorremos hacia atras y luego invertimos (antiguo -> reciente).
    while (cur >= startFirst && guard < 500) {
      const nextExcl = bucketNext(cur, gran);
      cols.push({
        kind: "emb",
        key: bucketKey(cur),
        desde: isoDay(cur),
        hasta: isoDay(nextExcl),
        label: bucketLabel(cur, nextExcl, gran),
        esHoy: false,
        gradT: 0,
      });
      cur = bucketPrev(cur, gran);
      guard += 1;
    }
    cols.reverse();
    return cols;
  }, [embFiltradas, gran, hoy, incluyeEmb, incluyeReq]);

  // Columna "presente" (bucket actual consolidado): en el render apila las
  // franjas embarcado / past-due / requerimiento del bucket que contiene hoy.
  // Existe cuando hay requerimiento (past-due es demanda vencida). En modo
  // embarques puro no aplica (el bucket actual queda como columna de embarque).
  const presenteCol = useMemo<Col | null>(() => {
    if (!incluyeReq) return null;
    const start = bucketStart(hoy, gran);
    const next = bucketNext(start, gran);
    return {
      kind: "presente",
      key: bucketKey(start), // = hoyKey: lee bucketsEmb/buckets del bucket actual
      desde: isoDay(start),
      hasta: isoDay(next),
      label: bucketLabel(start, next, gran),
      esHoy: true,
      gradT: 0, // bucket más cercano -> extremo NEAR del gradiente de requerimiento
    };
  }, [incluyeReq, hoy, gran]);

  // Eje unificado: [embarque antiguo -> reciente] [presente] [requerimiento].
  const eje = useMemo<Col[]>(() => {
    const arr: Col[] = [...colsEmb];
    if (presenteCol) arr.push(presenteCol);
    arr.push(...colsReq);
    return arr;
  }, [colsEmb, presenteCol, colsReq]);

  // Indice del ancla (columna presente, o primer requerimiento) dentro del eje.
  const idxAncla = colsEmb.length;

  const minColW = bucketWidth(gran);
  const usableWidth = Math.max(0, availWidth - COL1_W);
  const visibleCount = Math.max(
    1,
    Math.min(eje.length || 1, Math.floor(usableWidth / minColW) || 1),
  );
  const colW = usableWidth > 0 ? Math.max(minColW, usableWidth / visibleCount) : minColW;
  const maxOffset = Math.max(0, eje.length - visibleCount);

  // Offset que deja visible el "presente" (past-due + entorno).
  const offsetPresente = useMemo(() => {
    if (!incluyeReq) return maxOffset; // embarques puro: lo mas reciente
    const embVis = incluyeEmb ? Math.floor(visibleCount / 2) : 0;
    return clamp(idxAncla - embVis, 0, maxOffset);
  }, [incluyeReq, incluyeEmb, idxAncla, visibleCount, maxOffset]);

  // Recentrar al cambiar modo/granularidad, o cuando la estructura del eje
  // cambia (p.ej. al llegar los datos: colsEmb/colsReq pasan de 0 a N). La clave
  // NO depende del ancho, así que navegar con ◀▶ o redimensionar no fuerza un
  // recentrado (solo el clamp de offset actúa en esos casos).
  // `layoutListo` (availWidth>0) entra en la clave para recentrar UNA vez cuando
  // el ancho se mide por primera vez (visibleCount pasa de 1 a su valor real);
  // sin esto, si el recentro corre con availWidth=0 el offset queda descentrado.
  // Es un booleano estable, así que redimensionar luego no fuerza recentrado.
  const layoutListo = availWidth > 0;
  const prevKeyRef = useRef<string>("");
  useEffect(() => {
    const k = `${modo}|${gran}|${colsEmb.length}|${colsReq.length}|${layoutListo}`;
    if (prevKeyRef.current !== k) {
      prevKeyRef.current = k;
      setOffset(offsetPresente);
    }
  }, [modo, gran, colsEmb.length, colsReq.length, layoutListo, offsetPresente]);

  // Clamp del offset cuando cambian datos/ancho.
  useEffect(() => {
    setOffset((o) => Math.min(o, maxOffset));
  }, [maxOffset]);

  const columnasVisibles = useMemo(
    () => eje.slice(offset, offset + visibleCount),
    [eje, offset, visibleCount],
  );

  // Agrupacion por (PT x cliente x ciudad) — merge de requerimiento + embarque.
  // Las filas ANCLA son las del requerimiento (universo de demanda activa); los
  // embarques solo enriquecen filas existentes. Excepcion: en modo embarques
  // puro (sin requerimiento) las filas se crean desde los embarques.
  const filas = useMemo<FilaCal[]>(() => {
    const map = new Map<string, FilaCal>();
    const mkFila = (
      idMaterial: number,
      PT: string,
      descripcion: string,
      idCliente: number | null,
      cliente: string,
      idCiudad: number | null,
      ciudad: string,
    ): FilaCal => ({
      key: `${idMaterial}|${idCliente ?? "x"}|${idCiudad ?? "x"}`,
      idMaterial,
      PT,
      descripcion,
      idCliente,
      cliente,
      idCiudad,
      ciudad,
      pastDue: 0,
      buckets: new Map(),
      bucketsEmb: new Map(),
    });

    for (const c of reqFiltradas) {
      const key = `${c.idMaterial}|${c.idCliente ?? "x"}|${c.idCiudad ?? "x"}`;
      let fila = map.get(key);
      if (!fila) {
        fila = mkFila(c.idMaterial, c.PT, c.Descripcion, c.idCliente, c.Cliente, c.idCiudad, c.Ciudad);
        map.set(key, fila);
      }
      const f = parseISO(c.Fecha);
      if (f < hoy) {
        fila.pastDue += c.PiezasPend;
      } else {
        const bkey = bucketKey(bucketStart(f, gran));
        const cell = fila.buckets.get(bkey) ?? { total: 0, fc: 0 };
        cell.total += c.PiezasPend;
        if (c.bForecast) cell.fc += c.PiezasPend;
        fila.buckets.set(bkey, cell);
      }
    }
    // Embarques puro (sin requerimiento): permitir crear filas nuevas.
    const permitirNuevas = !incluyeReq;
    for (const c of embFiltradas) {
      const key = `${c.idMaterial}|${c.idCliente ?? "x"}|${c.idCiudad ?? "x"}`;
      let fila = map.get(key);
      if (!fila) {
        if (!permitirNuevas) continue; // solo enriquece filas de requerimiento
        fila = mkFila(c.idMaterial, c.PT, c.Descripcion, c.idCliente, c.Cliente, c.idCiudad, c.Ciudad);
        map.set(key, fila);
      }
      const f = parseISO(c.Fecha);
      const bkey = bucketKey(bucketStart(f, gran));
      fila.bucketsEmb.set(bkey, (fila.bucketsEmb.get(bkey) ?? 0) + c.PiezasEmbarcadas);
    }

    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      if (b.pastDue !== a.pastDue) return b.pastDue - a.pastDue;
      const ta = Array.from(a.buckets.values()).reduce((s, x) => s + x.total, 0);
      const tb = Array.from(b.buckets.values()).reduce((s, x) => s + x.total, 0);
      if (tb !== ta) return tb - ta;
      const ea = Array.from(a.bucketsEmb.values()).reduce((s, x) => s + x, 0);
      const eb = Array.from(b.bucketsEmb.values()).reduce((s, x) => s + x, 0);
      return eb - ea;
    });
    return arr;
  }, [reqFiltradas, embFiltradas, gran, hoy, incluyeReq]);

  // Tope de render (sin virtualizar). Los totales del footer se calculan sobre
  // TODAS las filas; solo el <tbody> se recorta.
  const filasRender = useMemo(() => filas.slice(0, MAX_FILAS), [filas]);
  const filasOcultas = Math.max(0, filas.length - MAX_FILAS);

  // Escala del heatmap cálido (requerimiento + past-due).
  const maxVal = useMemo(() => {
    let m = 0;
    for (const f of filas) {
      if (f.pastDue > m) m = f.pastDue;
      for (const c of f.buckets.values()) if (c.total > m) m = c.total;
    }
    return m || 1;
  }, [filas]);

  // Escala del heatmap azul (embarques) — separada para que un lado no aplaste al otro.
  const maxEmb = useMemo(() => {
    let m = 0;
    for (const f of filas) for (const v of f.bucketsEmb.values()) if (v > m) m = v;
    return m || 1;
  }, [filas]);

  // Totales por columna (footer).
  const totales = useMemo(() => {
    let pastDue = 0;
    const porBucket = new Map<string, number>();
    const porBucketEmb = new Map<string, number>();
    for (const f of filas) {
      pastDue += f.pastDue;
      for (const [k, c] of f.buckets) porBucket.set(k, (porBucket.get(k) ?? 0) + c.total);
      for (const [k, v] of f.bucketsEmb) porBucketEmb.set(k, (porBucketEmb.get(k) ?? 0) + v);
    }
    return { pastDue, porBucket, porBucketEmb };
  }, [filas]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Controls
        modo={modo}
        setModo={setModo}
        gran={gran}
        setGran={setGran}
        incluyeForecast={incluyeForecast}
        setIncluyeForecast={setIncluyeForecast}
        onPrev={() => setOffset((o) => Math.max(0, o - 1))}
        onNext={() => setOffset((o) => Math.min(maxOffset, o + 1))}
        onHoy={() => setOffset(offsetPresente)}
        canPrev={offset > 0}
        canNext={offset < maxOffset}
        enPresente={offset === offsetPresente}
      />

      {isLoading ? (
        <MatrizSkeleton />
      ) : error ? (
        <div className="px-4 py-6 text-sm text-status-empty">
          Error al cargar: {(error as Error).message}
        </div>
      ) : filas.length === 0 ? (
        <div className="px-4 py-6 text-sm text-ink-muted">
          Sin datos con los filtros actuales.
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          <table
            className="border-separate border-spacing-0 text-xs"
            style={{
              tableLayout: "fixed",
              width: availWidth > 0 ? "100%" : COL1_W + columnasVisibles.length * colW,
            }}
          >
            <colgroup>
              <col style={{ width: COL1_W }} />
              {columnasVisibles.map((col, i) => (
                <col key={`${col.key}-${i}`} style={{ width: colW }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th
                  className="sticky top-0 left-0 z-30 bg-surface-muted text-left px-3 py-2 font-medium text-ink-muted border-b border-r border-surface-border"
                  style={{ width: COL1_W, minWidth: COL1_W }}
                >
                  Número de parte
                </th>
                {columnasVisibles.map((col, i) => (
                  <th
                    key={`${col.key}-${i}`}
                    className={`sticky top-0 z-20 text-center px-1 py-1.5 font-medium border-b border-surface-border ${
                      col.kind === "emb" ? "text-[#2563eb]" : "text-ink-muted"
                    }`}
                    style={{
                      width: colW,
                      minWidth: colW,
                      backgroundColor:
                        col.kind === "emb"
                          ? blendOnWhite(EMB, 0.06)
                          : "var(--tw-surface-muted, #f1f5f9)",
                      ...hoyColStyle(col.esHoy, "top"),
                    }}
                  >
                    <div className="leading-tight whitespace-nowrap">{col.label.top}</div>
                    {col.label.sub ? (
                      <div className="text-[10px] text-ink-subtle leading-none whitespace-nowrap">
                        {col.label.sub}
                      </div>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filasRender.map((fila) => (
                <FilaMatriz
                  key={fila.key}
                  fila={fila}
                  columnas={columnasVisibles}
                  colW={colW}
                  maxVal={maxVal}
                  maxEmb={maxEmb}
                  incluyeEmb={incluyeEmb}
                  incluyeReq={incluyeReq}
                  hoyIso={isoDay(hoy)}
                  celda={
                    celdaDetalle?.idMaterial === fila.idMaterial &&
                    celdaDetalle?.idCliente === fila.idCliente &&
                    celdaDetalle?.idCiudad === fila.idCiudad
                      ? celdaDetalle
                      : null
                  }
                  onCell={(tipo, desde, hasta, etiqueta) =>
                    setCeldaDetalle({
                      tipo,
                      idMaterial: fila.idMaterial,
                      PT: fila.PT,
                      idCliente: fila.idCliente,
                      Cliente: fila.cliente,
                      idCiudad: fila.idCiudad,
                      Ciudad: fila.ciudad,
                      desde,
                      hasta,
                      etiqueta,
                    })
                  }
                />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td
                  className="sticky bottom-0 left-0 z-20 bg-surface-subtle text-right px-3 py-1.5 font-medium text-ink-muted border-t border-r border-surface-border"
                  style={{ width: COL1_W, minWidth: COL1_W }}
                >
                  Total
                </td>
                {columnasVisibles.map((col, i) => {
                  if (col.kind === "presente") {
                    const tEmb = totales.porBucketEmb.get(col.key) ?? 0;
                    const tReq = totales.porBucket.get(col.key) ?? 0;
                    return (
                      <td
                        key={`${col.key}-${i}`}
                        className="sticky bottom-0 z-10 bg-surface-subtle text-center tabular-nums border-t border-surface-border p-0"
                        style={{ width: colW, minWidth: colW, ...hoyColStyle(true, "bottom") }}
                      >
                        <div className="flex flex-col leading-tight py-0.5">
                          {incluyeEmb ? (
                            <span className="text-[#2563eb] font-semibold">{tEmb > 0 ? fmtInt(tEmb) : "—"}</span>
                          ) : null}
                          <span className="text-status-empty font-semibold">{totales.pastDue > 0 ? fmtInt(totales.pastDue) : "—"}</span>
                          <span className="text-ink font-semibold">{tReq > 0 ? fmtInt(tReq) : "—"}</span>
                        </div>
                      </td>
                    );
                  }
                  const v =
                    col.kind === "emb"
                      ? totales.porBucketEmb.get(col.key) ?? 0
                      : totales.porBucket.get(col.key) ?? 0;
                  return (
                    <td
                      key={`${col.key}-${i}`}
                      className={`sticky bottom-0 z-10 bg-surface-subtle text-center px-1 py-1.5 font-semibold tabular-nums border-t border-surface-border ${
                        col.kind === "emb" ? "text-[#2563eb]" : "text-ink"
                      }`}
                      style={{
                        width: colW,
                        minWidth: colW,
                        ...hoyColStyle(col.esHoy, "bottom"),
                      }}
                    >
                      {v > 0 ? fmtInt(v) : "—"}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Leyenda modo={modo} filasOcultas={filasOcultas} />

      {celdaDetalle ? (
        <DetalleCelda
          forecast={incluyeForecast}
          onClose={() => setCeldaDetalle(null)}
        />
      ) : null}
    </div>
  );
}

// ---- Controles -------------------------------------------------------------

function Controls({
  modo,
  setModo,
  gran,
  setGran,
  incluyeForecast,
  setIncluyeForecast,
  onPrev,
  onNext,
  onHoy,
  canPrev,
  canNext,
  enPresente,
}: {
  modo: CalModo;
  setModo: (m: CalModo) => void;
  gran: CalGranularidad;
  setGran: (g: CalGranularidad) => void;
  incluyeForecast: boolean;
  setIncluyeForecast: (v: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
  onHoy: () => void;
  canPrev: boolean;
  canNext: boolean;
  enPresente: boolean;
}) {
  const modos: { v: CalModo; label: string }[] = [
    { v: "requerimiento", label: "Requerim." },
    { v: "embarques", label: "Embarques" },
    { v: "ambos", label: "Ambos" },
  ];
  const opts: { v: CalGranularidad; label: string }[] = [
    { v: "dia", label: "Día" },
    { v: "semana", label: "Semana" },
    { v: "mes", label: "Mes" },
  ];
  return (
    <div className="shrink-0 px-3 py-2 border-b border-surface-border bg-surface-muted/70 flex items-center gap-2 flex-wrap">
      <div className="inline-flex rounded-md border border-surface-border overflow-hidden">
        {modos.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => setModo(o.v)}
            className={`px-2.5 py-1 text-xs transition ${
              modo === o.v
                ? "bg-status-pt/10 text-status-pt font-medium"
                : "text-ink-muted hover:bg-surface-subtle"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="inline-flex rounded-md border border-surface-border overflow-hidden">
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => setGran(o.v)}
            className={`px-2.5 py-1 text-xs transition ${
              gran === o.v
                ? "bg-status-pt/10 text-status-pt font-medium"
                : "text-ink-muted hover:bg-surface-subtle"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {modo !== "embarques" ? (
        <button
          type="button"
          onClick={() => setIncluyeForecast(!incluyeForecast)}
          aria-pressed={incluyeForecast}
          title="Incluir líneas forecast (bForecast=1). Se muestran hachuradas."
          className={`px-2.5 py-1 text-xs rounded-md border transition ${
            incluyeForecast
              ? "border-status-partial/50 bg-status-partial/10 text-status-partial font-medium"
              : "border-surface-border text-ink-muted hover:bg-surface-subtle"
          }`}
        >
          {incluyeForecast ? "Firme + forecast" : "Solo firme"}
        </button>
      ) : null}

      <div className="ml-auto inline-flex items-center gap-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={!canPrev}
          aria-label="Periodo anterior"
          title="Desplazar hacia atrás (más historia de embarques)"
          className="w-6 h-6 flex items-center justify-center rounded-md border border-surface-border text-ink-muted hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          {"◀"}
        </button>
        <button
          type="button"
          onClick={onHoy}
          disabled={enPresente}
          aria-label="Ir al presente"
          title={enPresente ? "La vista actual ya incluye el presente" : "Volver al presente"}
          className="px-2 h-6 flex items-center justify-center rounded-md border text-xs font-medium border-surface-border text-ink-muted hover:bg-surface-subtle disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:text-ink-subtle"
        >
          Hoy
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          aria-label="Periodo siguiente"
          title="Desplazar hacia adelante (requerimiento futuro)"
          className="w-6 h-6 flex items-center justify-center rounded-md border border-surface-border text-ink-muted hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          {"▶"}
        </button>
      </div>
    </div>
  );
}

// ---- Fila de la matriz -----------------------------------------------------

function FilaMatriz({
  fila,
  columnas,
  colW,
  maxVal,
  maxEmb,
  incluyeEmb,
  incluyeReq,
  hoyIso,
  celda,
  onCell,
}: {
  fila: FilaCal;
  columnas: Col[];
  colW: number;
  maxVal: number;
  maxEmb: number;
  incluyeEmb: boolean;
  incluyeReq: boolean;
  hoyIso: string; // límite superior EXCLUSIVO del past-due (= hoy real)
  celda: { tipo: "requerimiento" | "embarque"; desde: string | null } | null;
  onCell: (
    tipo: "requerimiento" | "embarque",
    desde: string | null,
    hasta: string,
    etiqueta: string,
  ) => void;
}) {
  return (
    <tr className="group">
      <td
        className="sticky left-0 z-10 bg-surface px-3 py-2 border-b border-r border-surface-border group-hover:bg-surface-subtle"
        style={{ width: COL1_W, minWidth: COL1_W }}
      >
        <div className="flex items-center gap-2">
          <PartThumbnail clave={fila.PT} size={34} />
          <div className="min-w-0">
            <div className="font-mono text-[13px] font-medium text-ink truncate" title={fila.descripcion}>
              {fila.PT}
            </div>
            <div className="text-[11px] text-ink-muted truncate" title={`${fila.cliente} · ${fila.ciudad}`}>
              {fila.cliente}
              {fila.ciudad ? <span className="text-ink-subtle"> · {fila.ciudad}</span> : null}
            </div>
          </div>
        </div>
      </td>

      {columnas.map((col, i) => {
        if (col.kind === "presente") {
          // Columna consolidada del bucket actual: franjas apiladas
          // embarcado (↑) / past-due (!) / requerimiento (●). Cada una lee su
          // dato del bucket actual (col.key = hoyKey) y abre su propio detalle.
          const emb = fila.bucketsEmb.get(col.key) ?? 0;
          const pd = fila.pastDue;
          const reqCell = fila.buckets.get(col.key);
          const req = reqCell?.total ?? 0;
          const reqFc = reqCell?.fc ?? 0;
          const reqPuroFc = req > 0 && reqFc >= req - 1e-6;

          const embBg = emb > 0 ? rgba(EMB, 0.15 + 0.85 * (emb / maxEmb)) : "transparent";
          const pdBg = pd > 0 ? blendOnWhite(PASTDUE, 0.18 + 0.82 * (pd / maxVal)) : "transparent";
          const reqBg = req > 0 ? rgba(NEAR, 0.18 + 0.82 * (req / maxVal)) : "transparent";

          const embSel = celda?.tipo === "embarque" && celda.desde === col.desde;
          const pdSel = celda?.tipo === "requerimiento" && celda.desde === null;
          const reqSel = celda?.tipo === "requerimiento" && celda.desde === col.desde;

          const franjaCls =
            "flex items-center justify-between gap-1 px-1.5 py-0.5 tabular-nums leading-none";
          const sep = "1px solid rgba(255,255,255,0.6)";

          return (
            <td
              key={`${col.key}-${i}`}
              className="border-b border-r border-surface-border p-0 align-middle"
              style={{ width: colW, minWidth: colW, ...hoyColStyle(true, "middle") }}
            >
              <div className="flex flex-col">
                {incluyeEmb ? (
                  <div
                    className={franjaCls}
                    style={{
                      backgroundColor: embBg,
                      borderBottom: sep,
                      color: emb > 0 ? "#1e293b" : "#cbd5e1",
                      cursor: emb > 0 ? "pointer" : "default",
                      outline: embSel ? "2px solid #3b82f6" : undefined,
                      outlineOffset: embSel ? -2 : undefined,
                    }}
                    onClick={() => emb > 0 && onCell("embarque", col.desde, col.hasta, col.label.top)}
                    title={emb > 0 ? `${fmtInt(emb)} pzs embarcadas · ${col.label.top}` : undefined}
                  >
                    <span className="text-[9px] opacity-60">↑</span>
                    <span>{emb > 0 ? fmtInt(emb) : "·"}</span>
                  </div>
                ) : null}
                {incluyeReq ? (
                  <>
                    <div
                      className={franjaCls}
                      style={{
                        backgroundColor: pdBg,
                        borderBottom: sep,
                        color: pd > 0 ? "#1e293b" : "#cbd5e1",
                        cursor: pd > 0 ? "pointer" : "default",
                        outline: pdSel ? "2px solid #3b82f6" : undefined,
                        outlineOffset: pdSel ? -2 : undefined,
                      }}
                      onClick={() => pd > 0 && onCell("requerimiento", null, hoyIso, "Past-due")}
                      title={pd > 0 ? `${fmtInt(pd)} pzs past-due` : "Sin past-due"}
                    >
                      <span className="text-[9px] opacity-60">!</span>
                      <span>{pd > 0 ? fmtInt(pd) : "·"}</span>
                    </div>
                    <div
                      className={franjaCls}
                      style={{
                        backgroundColor: reqBg,
                        backgroundImage: reqPuroFc ? HATCH : undefined,
                        color: req > 0 ? "#1e293b" : "#cbd5e1",
                        cursor: req > 0 ? "pointer" : "default",
                        outline: reqSel ? "2px solid #3b82f6" : undefined,
                        outlineOffset: reqSel ? -2 : undefined,
                      }}
                      onClick={() => req > 0 && onCell("requerimiento", col.desde, col.hasta, col.label.top)}
                      title={
                        req > 0
                          ? `${fmtInt(req)} pzs requeridas · ${col.label.top}${reqFc > 0 ? ` (${fmtInt(reqFc)} forecast)` : ""}`
                          : undefined
                      }
                    >
                      <span className="text-[9px] opacity-60">●</span>
                      <span>{req > 0 ? fmtInt(req) : "·"}</span>
                    </div>
                  </>
                ) : null}
              </div>
            </td>
          );
        }

        if (col.kind === "emb") {
          const v = fila.bucketsEmb.get(col.key) ?? 0;
          const bg = v > 0 ? rgba(EMB, 0.15 + 0.85 * (v / maxEmb)) : "transparent";
          const sel = celda?.tipo === "embarque" && celda.desde === col.desde;
          return (
            <td
              key={`${col.key}-${i}`}
              className="text-center tabular-nums border-b border-surface-border"
              style={{
                width: colW,
                minWidth: colW,
                backgroundColor: bg,
                color: v > 0 ? "#1e293b" : "#cbd5e1",
                cursor: v > 0 ? "pointer" : "default",
                outline: sel ? "2px solid #3b82f6" : undefined,
                outlineOffset: sel ? -2 : undefined,
              }}
              onClick={() => v > 0 && onCell("embarque", col.desde, col.hasta, col.label.top)}
              title={v > 0 ? `${fmtInt(v)} pzs embarcadas` : undefined}
            >
              {v > 0 ? fmtInt(v) : "·"}
            </td>
          );
        }

        // kind === "req"
        const cell = fila.buckets.get(col.key);
        const total = cell?.total ?? 0;
        const fc = cell?.fc ?? 0;
        const base = mix(NEAR, FAR, col.gradT);
        const bg = total > 0 ? rgba(base, 0.18 + 0.82 * (total / maxVal)) : "transparent";
        const puroForecast = total > 0 && fc >= total - 1e-6;
        const sel = celda?.tipo === "requerimiento" && celda.desde === col.desde;
        return (
          <td
            key={`${col.key}-${i}`}
            className="text-center tabular-nums border-b border-surface-border"
            style={{
              width: colW,
              minWidth: colW,
              backgroundColor: bg,
              backgroundImage: puroForecast ? HATCH : undefined,
              color: total > 0 ? "#1e293b" : "#cbd5e1",
              cursor: total > 0 ? "pointer" : "default",
              outline: sel ? "2px solid #3b82f6" : undefined,
              outlineOffset: sel ? -2 : undefined,
              ...hoyColStyle(col.esHoy, "middle"),
            }}
            onClick={() => total > 0 && onCell("requerimiento", col.desde, col.hasta, col.label.top)}
            title={
              total > 0
                ? `${fmtInt(total)} pzs${fc > 0 ? ` (${fmtInt(fc)} forecast)` : ""}`
                : undefined
            }
          >
            {total > 0 ? fmtInt(total) : "·"}
          </td>
        );
      })}
    </tr>
  );
}

// ---- Detalle (popover inferior) --------------------------------------------

function DetalleCelda({ forecast, onClose }: { forecast: boolean; onClose: () => void }) {
  const celda = useUiStore((s) => s.celdaDetalle);
  const esEmbarque = celda?.tipo === "embarque";

  const orden = useOrdenDetalle(
    !esEmbarque ? celda?.idMaterial ?? null : null,
    celda?.idCliente ?? null,
    celda?.idCiudad ?? null,
    celda?.desde ?? null,
    celda?.hasta ?? null,
    forecast,
  );
  const remision = useRemisionDetalle(
    esEmbarque ? celda?.idMaterial ?? null : null,
    celda?.idCliente ?? null,
    celda?.idCiudad ?? null,
    celda?.desde ?? null,
    celda?.hasta ?? null,
  );

  if (!celda) return null;

  const isLoading = esEmbarque ? remision.isLoading : orden.isLoading;
  const total = esEmbarque
    ? (remision.data ?? []).reduce((s, l) => s + l.Piezas, 0)
    : (orden.data ?? []).reduce((s, l) => s + l.PiezasPend, 0);
  const rows = esEmbarque ? remision.data ?? [] : orden.data ?? [];

  return (
    <div className="shrink-0 max-h-[42%] flex flex-col border-t-2 border-status-pt/40 bg-surface">
      <div className="shrink-0 px-3 py-2 bg-status-pt/5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-status-pt truncate">
            <span className="font-mono">{celda.PT}</span> ·{" "}
            {esEmbarque ? `Embarcado · ${celda.etiqueta}` : celda.etiqueta}
            {!isLoading ? <span className="text-ink-muted"> · {fmtInt(total)} pzs</span> : null}
          </div>
          <div className="text-[11px] text-ink-muted truncate">
            {celda.Cliente}
            {celda.Ciudad ? ` · ${celda.Ciudad}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar detalle"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-ink-muted hover:bg-surface-muted hover:text-ink"
        >
          {"✕"}
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        {isLoading ? (
          <div className="px-3 py-3 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-4 text-xs text-ink-muted">Sin líneas.</div>
        ) : esEmbarque ? (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-surface-muted text-ink-muted">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">Remisión</th>
                <th className="text-left px-2 py-1.5 font-medium">Orden venta</th>
                <th className="text-left px-2 py-1.5 font-medium">Fecha</th>
                <th className="text-right px-3 py-1.5 font-medium">Piezas</th>
                <th className="text-right px-3 py-1.5 font-medium">Precio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {(remision.data ?? []).map((l, i) => (
                <tr key={`${l.Remision ?? "x"}-${l.OrdenVenta ?? "x"}-${i}`} className="hover:bg-surface-subtle">
                  <td className="px-3 py-1.5 font-mono text-ink">{l.Remision ?? "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-ink-muted">{l.OrdenVenta ?? "—"}</td>
                  <td className="px-2 py-1.5 text-ink-muted">{fmtFecha(l.Fecha)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-ink">
                    {fmtInt(l.Piezas)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">
                    {l.PrecioUnitario != null ? nfMoney.format(l.PrecioUnitario) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-surface-muted text-ink-muted">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">Orden venta</th>
                <th className="text-left px-2 py-1.5 font-medium">PO / línea</th>
                <th className="text-left px-2 py-1.5 font-medium">Fecha</th>
                <th className="text-right px-3 py-1.5 font-medium">Pend.</th>
                <th className="text-right px-3 py-1.5 font-medium">Precio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {(orden.data ?? []).map((l, i) => (
                <tr key={`${l.OrdenVenta ?? "x"}-${l.POLine ?? "x"}-${i}`} className="hover:bg-surface-subtle">
                  <td className="px-3 py-1.5 font-mono text-ink">
                    {l.OrdenVenta ?? "—"}
                    {l.bForecast ? (
                      <span className="ml-1 text-[10px] text-status-partial">forecast</span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-ink-muted truncate max-w-[140px]" title={`${l.POHeader ?? ""} ${l.POLine ?? ""}`}>
                    {l.POLine ?? l.POHeader ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-ink-muted">{fmtFecha(l.Fecha)}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums text-ink">
                    {fmtInt(l.PiezasPend)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">
                    {l.PrecioUnitario != null ? nfMoney.format(l.PrecioUnitario) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function fmtFecha(iso: string): string {
  const d = parseISO(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MESES[d.getMonth()]}`;
}

// ---- Leyenda + skeleton ----------------------------------------------------

function Leyenda({ modo, filasOcultas }: { modo: CalModo; filasOcultas: number }) {
  const verEmb = modo !== "requerimiento";
  const verReq = modo !== "embarques";
  return (
    <div className="shrink-0 px-3 py-1.5 border-t border-surface-border bg-surface flex items-center gap-3 text-[11px] text-ink-subtle flex-wrap">
      {filasOcultas > 0 ? (
        <span className="text-status-partial" title="Refina con los filtros (Nº de parte, cliente, ciudad) para acotar el listado.">
          +{fmtInt(filasOcultas)} filas ocultas · filtra
        </span>
      ) : null}
      {verEmb ? (
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: rgba(EMB, 0.8) }} />
          Embarcado
        </span>
      ) : null}
      {verReq ? (
        <>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: rgba(PASTDUE, 0.8) }} />
            Past-due
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: rgba(NEAR, 0.8) }} />
            Cercano
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: rgba(FAR, 0.8) }} />
            Lejano
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="w-3 h-3 rounded-sm border border-surface-border"
              style={{ backgroundImage: HATCH, backgroundColor: rgba(NEAR, 0.5) }}
            />
            Forecast
          </span>
        </>
      ) : null}
      <span className="ml-auto">Clic en celda → detalle</span>
    </div>
  );
}

function MatrizSkeleton() {
  return (
    <div className="flex-1 min-h-0 overflow-hidden p-3 space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="h-9 w-9" rounded="md" />
          <Skeleton className="h-9 flex-1" />
        </div>
      ))}
    </div>
  );
}
