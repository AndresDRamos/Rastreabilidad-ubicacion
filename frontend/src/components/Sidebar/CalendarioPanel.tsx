import { useMemo } from "react";

import { useOrdenDetalle, useRequerimientoCalendario } from "@/api/queries";
import type { CalGranularidad, CeldaCalendario } from "@/api/types";
import { PartThumbnail } from "@/components/Canvas/nodes/PartThumbnail";
import { Skeleton } from "@/components/ui/Skeleton";
import { useUiStore } from "@/store/useUiStore";

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

const nfInt = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const nfMoney = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function fmtInt(n: number): string {
  return nfInt.format(Math.round(n));
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
const NEAR: RGB = [216, 90, 48]; // coral (urgente / cercano)
const FAR: RGB = [29, 158, 117]; // teal (lejano)
const PASTDUE: RGB = [226, 75, 74]; // rojo

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

// Blend sobre blanco -> color solido (para celdas sticky, que deben ser opacas).
function blendOnWhite([r, g, b]: RGB, a: number): string {
  const mixCh = (c: number) => Math.round(255 * (1 - a) + c * a);
  return `rgb(${mixCh(r)}, ${mixCh(g)}, ${mixCh(b)})`;
}

const HATCH =
  "repeating-linear-gradient(45deg, rgba(255,255,255,0.5) 0 3px, transparent 3px 6px)";

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
  // por bucketKey: total y porcion forecast
  buckets: Map<string, { total: number; fc: number }>;
}

const COL1_W = 210;
const COL2_W = 66;
const BUCKET_W = 58;
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
  const celdaDetalle = useUiStore((s) => s.celdaDetalle);
  const setCeldaDetalle = useUiStore((s) => s.setCeldaDetalle);

  const { data: celdas, isLoading, error } = useRequerimientoCalendario(
    ventana,
    filters.fechaMax,
    universo,
  );

  const hoy = useMemo(() => hoyLocal(), []);

  // Filtrado client-side (mismo patron que el listado): pt/cliente/ciudad y forecast.
  const filtradas = useMemo<CeldaCalendario[]>(() => {
    if (!celdas) return [];
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
  }, [celdas, filters.ptIds, filters.clienteIds, filters.ciudadIds, incluyeForecast]);

  // Columnas de tiempo (buckets contiguos desde hoy hasta el ultimo dato futuro).
  const columnas = useMemo(() => {
    let maxFut: Date | null = null;
    for (const c of filtradas) {
      const f = parseISO(c.Fecha);
      if (f >= hoy && (maxFut === null || f > maxFut)) maxFut = f;
    }
    const cols: { key: string; start: Date; nextExcl: Date; label: { top: string; sub: string } }[] = [];
    if (maxFut === null) return cols;
    let cur = bucketStart(hoy, gran);
    const endStart = bucketStart(maxFut, gran);
    let guard = 0;
    while (cur <= endStart && guard < 400) {
      const nextExcl = bucketNext(cur, gran);
      cols.push({ key: bucketKey(cur), start: new Date(cur), nextExcl, label: bucketLabel(cur, nextExcl, gran) });
      cur = nextExcl;
      guard += 1;
    }
    return cols;
  }, [filtradas, gran, hoy]);

  // Agrupacion por (PT x cliente x ciudad).
  const filas = useMemo<FilaCal[]>(() => {
    const map = new Map<string, FilaCal>();
    for (const c of filtradas) {
      const key = `${c.idMaterial}|${c.idCliente ?? "x"}|${c.idCiudad ?? "x"}`;
      let fila = map.get(key);
      if (!fila) {
        fila = {
          key,
          idMaterial: c.idMaterial,
          PT: c.PT,
          descripcion: c.Descripcion,
          idCliente: c.idCliente,
          cliente: c.Cliente,
          idCiudad: c.idCiudad,
          ciudad: c.Ciudad,
          pastDue: 0,
          buckets: new Map(),
        };
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
    // Orden: past-due DESC, luego total futuro DESC.
    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      if (b.pastDue !== a.pastDue) return b.pastDue - a.pastDue;
      const ta = Array.from(a.buckets.values()).reduce((s, x) => s + x.total, 0);
      const tb = Array.from(b.buckets.values()).reduce((s, x) => s + x.total, 0);
      return tb - ta;
    });
    return arr;
  }, [filtradas, gran, hoy]);

  // Escala del heatmap: maximo entre todas las celdas mostradas (futuras + past-due).
  const maxVal = useMemo(() => {
    let m = 0;
    for (const f of filas) {
      if (f.pastDue > m) m = f.pastDue;
      for (const c of f.buckets.values()) if (c.total > m) m = c.total;
    }
    return m || 1;
  }, [filas]);

  // Totales por columna (footer).
  const totales = useMemo(() => {
    let pastDue = 0;
    const porBucket = new Map<string, number>();
    for (const f of filas) {
      pastDue += f.pastDue;
      for (const [k, c] of f.buckets) porBucket.set(k, (porBucket.get(k) ?? 0) + c.total);
    }
    return { pastDue, porBucket };
  }, [filas]);

  const forecastLinea = useUiStore((s) => s.calIncluyeForecast);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Controls
        gran={gran}
        setGran={setGran}
        incluyeForecast={incluyeForecast}
        setIncluyeForecast={setIncluyeForecast}
      />

      {isLoading ? (
        <MatrizSkeleton />
      ) : error ? (
        <div className="px-4 py-6 text-sm text-status-empty">
          Error al cargar el requerimiento: {(error as Error).message}
        </div>
      ) : filas.length === 0 ? (
        <div className="px-4 py-6 text-sm text-ink-muted">
          Sin demanda con los filtros actuales.
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <table
            className="border-separate border-spacing-0 text-xs"
            style={{
              tableLayout: "fixed",
              width: COL1_W + COL2_W + columnas.length * bucketWidth(gran),
            }}
          >
            <colgroup>
              <col style={{ width: COL1_W }} />
              <col style={{ width: COL2_W }} />
              {columnas.map((col) => (
                <col key={col.key} style={{ width: bucketWidth(gran) }} />
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
                <th
                  className="sticky top-0 z-30 text-center px-1 py-2 font-medium text-status-empty border-b border-r border-surface-border"
                  style={{
                    left: COL1_W,
                    width: COL2_W,
                    minWidth: COL2_W,
                    backgroundColor: blendOnWhite(PASTDUE, 0.12),
                  }}
                >
                  Past-due
                </th>
                {columnas.map((col) => (
                  <th
                    key={col.key}
                    className="sticky top-0 z-20 bg-surface-muted text-center px-1 py-1.5 font-medium text-ink-muted border-b border-surface-border"
                    style={{ width: bucketWidth(gran), minWidth: bucketWidth(gran) }}
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
              {filas.map((fila) => (
                <FilaMatriz
                  key={fila.key}
                  fila={fila}
                  columnas={columnas}
                  maxVal={maxVal}
                  hoy={hoy}
                  gran={gran}
                  selectedKey={celdaDetalle?.idMaterial === fila.idMaterial
                    && celdaDetalle?.idCliente === fila.idCliente
                    && celdaDetalle?.idCiudad === fila.idCiudad
                    ? celdaDetalle
                    : null}
                  onCell={(desde, hasta, etiqueta) =>
                    setCeldaDetalle({
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
                <td
                  className="sticky bottom-0 z-20 bg-surface-subtle text-center px-1 py-1.5 font-semibold tabular-nums text-status-empty border-t border-r border-surface-border"
                  style={{ left: COL1_W, width: COL2_W, minWidth: COL2_W }}
                >
                  {totales.pastDue > 0 ? fmtInt(totales.pastDue) : "—"}
                </td>
                {columnas.map((col) => {
                  const v = totales.porBucket.get(col.key) ?? 0;
                  return (
                    <td
                      key={col.key}
                      className="sticky bottom-0 z-10 bg-surface-subtle text-center px-1 py-1.5 font-semibold tabular-nums text-ink border-t border-surface-border"
                      style={{ width: bucketWidth(gran), minWidth: bucketWidth(gran) }}
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

      <Leyenda />

      {celdaDetalle ? (
        <DetalleOrden forecast={forecastLinea} onClose={() => setCeldaDetalle(null)} />
      ) : null}
    </div>
  );
}

// ---- Controles -------------------------------------------------------------

function Controls({
  gran,
  setGran,
  incluyeForecast,
  setIncluyeForecast,
}: {
  gran: CalGranularidad;
  setGran: (g: CalGranularidad) => void;
  incluyeForecast: boolean;
  setIncluyeForecast: (v: boolean) => void;
}) {
  const opts: { v: CalGranularidad; label: string }[] = [
    { v: "dia", label: "Día" },
    { v: "semana", label: "Semana" },
    { v: "mes", label: "Mes" },
  ];
  return (
    <div className="shrink-0 px-3 py-2 border-b border-surface-border bg-surface-muted/70 flex items-center gap-2 flex-wrap">
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
    </div>
  );
}

// ---- Fila de la matriz -----------------------------------------------------

function FilaMatriz({
  fila,
  columnas,
  maxVal,
  hoy,
  gran,
  selectedKey,
  onCell,
}: {
  fila: FilaCal;
  columnas: { key: string; start: Date; nextExcl: Date; label: { top: string; sub: string } }[];
  maxVal: number;
  hoy: Date;
  gran: CalGranularidad;
  selectedKey: { desde: string | null; hasta: string | null } | null;
  onCell: (desde: string | null, hasta: string | null, etiqueta: string) => void;
}) {
  const n = columnas.length;
  const pastDueBg =
    fila.pastDue > 0
      ? blendOnWhite(PASTDUE, 0.18 + 0.82 * (fila.pastDue / maxVal))
      : "#ffffff";
  const pastDueSel = selectedKey && selectedKey.desde === null;

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

      {/* Past-due fijo */}
      <td
        className={`sticky z-10 text-center tabular-nums border-b border-r cursor-pointer ${
          pastDueSel ? "border-status-pt" : "border-surface-border"
        }`}
        style={{
          left: COL1_W,
          width: COL2_W,
          minWidth: COL2_W,
          backgroundColor: pastDueBg,
          color: "#1e293b",
          outline: pastDueSel ? "2px solid #3b82f6" : undefined,
          outlineOffset: pastDueSel ? -2 : undefined,
        }}
        onClick={() =>
          fila.pastDue > 0 && onCell(null, isoDay(hoy), "Past-due")
        }
        title={fila.pastDue > 0 ? `${fmtInt(fila.pastDue)} pzs past-due` : "Sin past-due"}
      >
        {fila.pastDue > 0 ? fmtInt(fila.pastDue) : ""}
      </td>

      {columnas.map((col, i) => {
        const cell = fila.buckets.get(col.key);
        const total = cell?.total ?? 0;
        const fc = cell?.fc ?? 0;
        const base = mix(NEAR, FAR, n > 1 ? i / (n - 1) : 0);
        const bg = total > 0 ? rgba(base, 0.18 + 0.82 * (total / maxVal)) : "transparent";
        const puroForecast = total > 0 && fc >= total - 1e-6;
        const desde = isoDay(col.start);
        const hasta = isoDay(col.nextExcl);
        const sel = selectedKey && selectedKey.desde === desde;
        const etiqueta =
          gran === "mes" ? `${col.label.top} ${col.label.sub}` : col.label.top;
        return (
          <td
            key={col.key}
            className="text-center tabular-nums border-b border-surface-border"
            style={{
              width: bucketWidth(gran),
              minWidth: bucketWidth(gran),
              backgroundColor: bg,
              backgroundImage: puroForecast ? HATCH : undefined,
              color: total > 0 ? "#1e293b" : "#cbd5e1",
              cursor: total > 0 ? "pointer" : "default",
              outline: sel ? "2px solid #3b82f6" : undefined,
              outlineOffset: sel ? -2 : undefined,
            }}
            onClick={() => total > 0 && onCell(desde, hasta, etiqueta)}
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

// ---- Detalle de orden (popover inferior) -----------------------------------

function DetalleOrden({ forecast, onClose }: { forecast: boolean; onClose: () => void }) {
  const celda = useUiStore((s) => s.celdaDetalle);
  const { data, isLoading } = useOrdenDetalle(
    celda?.idMaterial ?? null,
    celda?.idCliente ?? null,
    celda?.idCiudad ?? null,
    celda?.desde ?? null,
    celda?.hasta ?? null,
    forecast,
  );

  if (!celda) return null;
  const total = (data ?? []).reduce((s, l) => s + l.PiezasPend, 0);

  return (
    <div className="shrink-0 max-h-[42%] flex flex-col border-t-2 border-status-pt/40 bg-surface">
      <div className="shrink-0 px-3 py-2 bg-status-pt/5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-status-pt truncate">
            <span className="font-mono">{celda.PT}</span> · {celda.etiqueta}
            {data ? <span className="text-ink-muted"> · {fmtInt(total)} pzs</span> : null}
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
        ) : (data ?? []).length === 0 ? (
          <div className="px-3 py-4 text-xs text-ink-muted">Sin líneas.</div>
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
              {(data ?? []).map((l, i) => (
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

function Leyenda() {
  return (
    <div className="shrink-0 px-3 py-1.5 border-t border-surface-border bg-surface flex items-center gap-3 text-[11px] text-ink-subtle flex-wrap">
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
      <span className="ml-auto">Clic en celda → detalle de orden</span>
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
