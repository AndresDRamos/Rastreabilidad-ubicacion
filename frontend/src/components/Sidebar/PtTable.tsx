import { useEffect, useMemo, useState } from "react";

import { usePts } from "@/api/queries";
import type { FilaListado } from "@/api/types";
import { useUiStore } from "@/store/useUiStore";

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
  const { data: filas, isLoading, error } = usePts(ventana, filters.fechaMax);
  const selectedPtIds = useUiStore((s) => s.selectedPtIds);
  const togglePt = useUiStore((s) => s.togglePt);
  const [page, setPage] = useState(0);

  const filasFiltradas = useMemo<FilaListado[]>(() => {
    if (!filas) return [];
    return filas
      .filter(
        (f) =>
          matchesFilter(f.Cliente, filters.cliente) &&
          matchesFilter(f.Ciudad, filters.ciudad) &&
          matchesFilter(f.PT, filters.pt),
      )
      .sort((a, b) => {
        if (b.PiezasPastDue !== a.PiezasPastDue) {
          return b.PiezasPastDue - a.PiezasPastDue;
        }
        return b.PiezasPend - a.PiezasPend;
      });
  }, [filas, filters]);

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

  if (filasFiltradas.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-ink-muted">
        Sin resultados con los filtros actuales.
      </div>
    );
  }

  const from = page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, filasFiltradas.length);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 py-2 bg-surface-muted/80 backdrop-blur-sm border-b border-surface-border text-xs text-ink-subtle">
        {filasFiltradas.length} de {filas?.length ?? 0} PTs
      </div>
      <ul className="flex-1 overflow-y-auto divide-y divide-surface-border">
        {pageRows.map((f) => (
          <PtRow
            key={`${f.idMaterial}-${f.idCliente ?? "x"}-${f.idCiudad ?? "x"}`}
            fila={f}
            checked={selectedPtIds.includes(f.idMaterial)}
            onToggle={() => togglePt(f.idMaterial)}
          />
        ))}
      </ul>
      <footer className="shrink-0 px-3 py-2 border-t border-surface-border bg-surface flex items-center justify-between gap-2 text-xs">
        <span className="text-ink-subtle tabular-nums">
          {fmtInt(from)}–{fmtInt(to)} de {fmtInt(filasFiltradas.length)}
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
    </div>
  );
}

function PtRow({
  fila,
  checked,
  onToggle,
}: {
  fila: FilaListado;
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
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-sm font-medium text-ink truncate">
                {fila.PT}
              </span>
              <span className="text-sm tabular-nums text-ink">
                {fmtInt(fila.PiezasPend)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2 mt-0.5">
              <span className="text-xs text-ink-muted truncate">
                {fila.Cliente}
                {fila.Ciudad ? <span className="text-ink-subtle"> · {fila.Ciudad}</span> : null}
              </span>
              {fila.PiezasPastDue > 0 ? (
                <span className="text-xs tabular-nums text-status-empty font-medium">
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
