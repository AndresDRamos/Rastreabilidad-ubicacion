import { useEffect, useMemo, useState } from "react";

import { usePts, usePtsEnProceso } from "@/api/queries";
import type { FilaListado } from "@/api/types";
import { useUiStore } from "@/store/useUiStore";
import { PartThumbnail } from "@/components/Canvas/nodes/PartThumbnail";

const PAGE_SIZE = 25;

function fmtInt(n: number): string {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }).format(n);
}

function matchesFilter(value: string, query: string): boolean {
  if (!query) return true;
  return value.toLowerCase().includes(query.toLowerCase());
}

export function PtTable() {
  const ventana = useUiStore((s) => s.ventana);
  const filters = useUiStore((s) => s.filters);
  const procesoFiltro = useUiStore((s) => s.procesoFiltro);
  const setProcesoFiltro = useUiStore((s) => s.setProcesoFiltro);

  const { data: filas, isLoading, error } = usePts(ventana, filters.fechaMax);
  const { data: ptsEnProceso, isLoading: loadingProceso } = usePtsEnProceso(
    procesoFiltro?.idProceso ?? null,
    filters.clienteId,
    filters.plantaId,
    filters.ciudadIds,
  );

  const selectedPtIds = useUiStore((s) => s.selectedPtIds);
  const togglePt = useUiStore((s) => s.togglePt);
  const [page, setPage] = useState(0);

  // Lookup: idPT -> piezas en el proceso seleccionado (para badge en cada row).
  const piezasPorPt = useMemo<Map<number, number>>(() => {
    if (!procesoFiltro || !ptsEnProceso) return new Map();
    const m = new Map<number, number>();
    for (const p of ptsEnProceso) m.set(p.idPT, p.PiezasEnProceso);
    return m;
  }, [procesoFiltro, ptsEnProceso]);

  const filasFiltradas = useMemo<FilaListado[]>(() => {
    if (!filas) return [];
    const ciudadSet =
      filters.ciudadIds.length > 0 ? new Set(filters.ciudadIds) : null;
    const base = filas.filter(
      (f) =>
        (filters.clienteId == null || f.idCliente === filters.clienteId) &&
        (ciudadSet == null ||
          (f.idCiudad != null && ciudadSet.has(f.idCiudad))) &&
        matchesFilter(f.PT, filters.pt),
    );
    // Si hay filtro de proceso activo, intersectar con el set de Q2.
    const ptsAllowed = procesoFiltro && ptsEnProceso
      ? new Set(ptsEnProceso.map((p) => p.idPT))
      : null;
    const filtradas = ptsAllowed
      ? base.filter((f) => ptsAllowed.has(f.idMaterial))
      : base;

    if (procesoFiltro) {
      // Ordenar por piezas en proceso DESC cuando hay drill activo.
      return filtradas.sort((a, b) => {
        const pa = piezasPorPt.get(a.idMaterial) ?? 0;
        const pb = piezasPorPt.get(b.idMaterial) ?? 0;
        if (pb !== pa) return pb - pa;
        return b.PiezasPend - a.PiezasPend;
      });
    }
    return filtradas.sort((a, b) => {
      if (b.PiezasPastDue !== a.PiezasPastDue) {
        return b.PiezasPastDue - a.PiezasPastDue;
      }
      return b.PiezasPend - a.PiezasPend;
    });
  }, [filas, filters, procesoFiltro, ptsEnProceso, piezasPorPt]);

  const totales = useMemo(() => {
    let req = 0;
    let pastDue = 0;
    let piezasProc = 0;
    for (const f of filasFiltradas) {
      req += f.PiezasPend;
      pastDue += f.PiezasPastDue;
      piezasProc += piezasPorPt.get(f.idMaterial) ?? 0;
    }
    return { req, pastDue, piezasProc };
  }, [filasFiltradas, piezasPorPt]);

  const totalPages = Math.max(1, Math.ceil(filasFiltradas.length / PAGE_SIZE));

  // Reset / clamp de pagina cuando cambian los filtros o el listado.
  useEffect(() => {
    if (page > totalPages - 1) setPage(0);
  }, [totalPages, page]);

  const pageRows = useMemo(
    () => filasFiltradas.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [filasFiltradas, page],
  );

  if (isLoading) {
    return <div className="px-4 py-6 text-sm text-ink-muted">Cargando PTs...</div>;
  }

  if (error) {
    return (
      <div className="px-4 py-6 text-sm text-status-empty">
        Error al cargar el listado: {(error as Error).message}
      </div>
    );
  }

  const showProcesoChip = procesoFiltro !== null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {showProcesoChip ? (
        <div className="px-4 py-2 bg-status-pt/5 border-b border-surface-border flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-ink-muted shrink-0">Proceso:</span>
            <span className="font-medium text-status-pt truncate">
              {procesoFiltro!.nombre}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setProcesoFiltro(null)}
            className="shrink-0 inline-flex items-center gap-1 text-status-pt hover:bg-status-pt/10 rounded px-1.5 py-0.5 transition"
            aria-label="Quitar filtro de proceso"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-3 h-3"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            quitar
          </button>
        </div>
      ) : null}

      <div className="px-4 py-2 bg-surface-muted/80 backdrop-blur-sm border-b border-surface-border flex items-center justify-between gap-2 text-xs">
        {showProcesoChip ? (
          <>
            <span className="text-sm font-semibold tabular-nums text-status-pt">
              {fmtInt(totales.piezasProc)}{" "}
              <span className="text-[10px] font-normal text-ink-subtle">
                pzs en proceso
              </span>
            </span>
            <span className="text-ink-subtle tabular-nums">
              {fmtInt(filasFiltradas.length)} PTs
            </span>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold tabular-nums text-ink">
              {fmtInt(totales.req)}
            </span>
            {totales.pastDue > 0 ? (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium tabular-nums bg-status-empty/10 text-status-empty">
                {fmtInt(totales.pastDue)} past-due
              </span>
            ) : null}
          </>
        )}
      </div>

      {filasFiltradas.length === 0 ? (
        <div className="px-4 py-6 text-sm text-ink-muted">
          {showProcesoChip && loadingProceso
            ? "Cargando PTs del proceso..."
            : "Sin resultados con los filtros actuales."}
        </div>
      ) : (
        <>
          <ul className="flex-1 overflow-y-auto divide-y divide-surface-border">
            {pageRows.map((f) => (
              <PtRow
                key={`${f.idMaterial}-${f.idCliente ?? "x"}-${f.idCiudad ?? "x"}`}
                fila={f}
                piezasEnProceso={
                  procesoFiltro ? piezasPorPt.get(f.idMaterial) ?? 0 : null
                }
                procesoNombre={procesoFiltro?.nombre ?? null}
                checked={selectedPtIds.includes(f.idMaterial)}
                onToggle={() => togglePt(f.idMaterial)}
              />
            ))}
          </ul>
          <footer className="shrink-0 px-3 py-2 border-t border-surface-border bg-surface flex items-center justify-between gap-2 text-xs">
            <span className="text-ink-subtle tabular-nums">
              {fmtInt(page * PAGE_SIZE + 1)}–
              {fmtInt(Math.min((page + 1) * PAGE_SIZE, filasFiltradas.length))}{" "}
              de {fmtInt(filasFiltradas.length)}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                aria-label="Pagina anterior"
                className="w-7 h-7 flex items-center justify-center rounded border border-surface-border text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                {"<"}
              </button>
              <span className="px-2 tabular-nums text-ink">
                {page + 1} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                aria-label="Pagina siguiente"
                className="w-7 h-7 flex items-center justify-center rounded border border-surface-border text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                {">"}
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

function PtRow({
  fila,
  piezasEnProceso,
  procesoNombre,
  checked,
  onToggle,
}: {
  fila: FilaListado;
  piezasEnProceso: number | null;
  procesoNombre: string | null;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full text-left px-4 py-2.5 hover:bg-surface-subtle transition focus:outline-none focus:bg-surface-subtle ${
          checked ? "bg-status-pt/5" : ""
        }`}
      >
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={checked}
            readOnly
            className="mt-1 h-4 w-4 rounded border-surface-border text-status-pt accent-status-pt"
          />
          <PartThumbnail clave={fila.PT} size={48} />
          <div className="flex-1 min-w-0">
            <div className="font-mono text-sm font-medium text-ink truncate">
              {fila.PT}
            </div>
            <div className="flex items-center gap-1 text-xs mt-0.5">
              <span
                className="text-ink-muted truncate min-w-0 flex-1"
                title={fila.Cliente}
              >
                {fila.Cliente}
              </span>
              {fila.Ciudad ? (
                <span className="text-ink-subtle shrink-0">· {fila.Ciudad}</span>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 mt-1.5">
              <span className="text-sm font-semibold tabular-nums text-ink">
                {fmtInt(fila.PiezasPend)}
              </span>
              {piezasEnProceso !== null ? (
                <span
                  className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium tabular-nums bg-status-pt/10 text-status-pt"
                  title={`${fmtInt(piezasEnProceso)} pzs esperando ${procesoNombre}`}
                >
                  {fmtInt(piezasEnProceso)} en {procesoNombre}
                </span>
              ) : fila.PiezasPastDue > 0 ? (
                <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium tabular-nums bg-status-empty/10 text-status-empty">
                  {fmtInt(fila.PiezasPastDue)} past-due
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </button>
    </li>
  );
}
