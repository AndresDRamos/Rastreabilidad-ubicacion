import { useMemo } from "react";

import { useBloques, usePlantas } from "@/api/queries";
import type { BloqueProceso } from "@/api/types";
import { fmtInt } from "@/lib/format";
import { useUiStore } from "@/store/useUiStore";
import { TipoMaterialSelect } from "./TipoMaterialSelect";

export function SummaryView() {
  const clienteId = useUiStore((s) => s.filters.clienteId);
  const plantaId = useUiStore((s) => s.filters.plantaId);
  const ciudadIds = useUiStore((s) => s.filters.ciudadIds);
  const tipoMaterialIds = useUiStore((s) => s.filters.tipoMaterialIds);
  const claseIds = useUiStore((s) => s.filters.claseIds);
  const setFilter = useUiStore((s) => s.setFilter);
  const { data: bloques, isLoading, error, isFetching } = useBloques(
    clienteId,
    plantaId,
    ciudadIds,
    tipoMaterialIds,
    claseIds,
  );
  const procesoFiltro = useUiStore((s) => s.procesoFiltro);
  const setProcesoFiltro = useUiStore((s) => s.setProcesoFiltro);

  const totales = useMemo(() => {
    if (!bloques) {
      return { piezas: 0, etiquetas: 0, procesos: 0 };
    }
    let piezas = 0;
    let etiquetas = 0;
    for (const b of bloques) {
      piezas += b.Disponibles + b.Recibidas + b.PorTransferir;
      etiquetas += b.Etiquetas;
    }
    return { piezas, etiquetas, procesos: bloques.length };
  }, [bloques]);

  const showSkeleton = isLoading || (isFetching && !bloques);

  return (
    <div className="h-full overflow-y-auto bg-surface-muted">
      <header className="bg-white border-b border-surface-border px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">
              Inventario por proceso
            </h2>
          </div>
          {bloques ? (
            <div className="flex items-center gap-4 text-right shrink-0">
              <Stat label="Procesos" value={fmtInt(totales.procesos)} />
              <Stat label="Etiquetas" value={fmtInt(totales.etiquetas)} />
              <Stat label="Piezas" value={fmtInt(totales.piezas)} emphasis />
            </div>
          ) : null}
        </div>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <PlantaSelect
            value={plantaId}
            onChange={(v) => setFilter("plantaId", v)}
          />
          <TipoMaterialSelect
            value={tipoMaterialIds}
            onChange={(v) => setFilter("tipoMaterialIds", v)}
          />
          {clienteId !== null ? (
            <FilterChip
              label="Cliente fijado"
              onRemove={() => setFilter("clienteId", null)}
            />
          ) : null}
          {ciudadIds.length > 0 ? (
            <FilterChip
              label={
                ciudadIds.length === 1
                  ? "1 ciudad"
                  : `${ciudadIds.length} ciudades`
              }
              onRemove={() => setFilter("ciudadIds", [])}
            />
          ) : null}
          {claseIds.length > 0 ? (
            <FilterChip
              label={
                claseIds.length === 1
                  ? "1 clase"
                  : `${claseIds.length} clases`
              }
              onRemove={() => setFilter("claseIds", [])}
            />
          ) : null}
          {isFetching && !isLoading ? (
            <span className="text-[11px] text-ink-subtle">actualizando...</span>
          ) : null}
        </div>
      </header>

      <div className="p-6">
        {showSkeleton ? (
          <BloquesSkeleton />
        ) : error ? (
          <div className="text-sm text-status-empty">
            Error al cargar: {(error as Error).message}
          </div>
        ) : !bloques || bloques.length === 0 ? (
          <div className="text-sm text-ink-muted">
            Sin WIP activo con los filtros actuales.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...bloques]
              .sort(
                (a, b) =>
                  b.Disponibles + b.Recibidas + b.PorTransferir -
                  (a.Disponibles + a.Recibidas + a.PorTransferir),
              )
              .map((b) => (
              <ProcessBlock
                key={b.idProceso ?? `null-${b.Proceso}`}
                bloque={b}
                selected={
                  procesoFiltro !== null &&
                  b.idProceso !== null &&
                  b.idProceso === procesoFiltro.idProceso
                }
                onClick={() => {
                  if (b.idProceso === null) return;
                  if (
                    procesoFiltro !== null &&
                    procesoFiltro.idProceso === b.idProceso
                  ) {
                    setProcesoFiltro(null);
                  } else {
                    setProcesoFiltro({
                      idProceso: b.idProceso,
                      nombre: b.Proceso,
                    });
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-status-pt bg-status-pt/5 border border-status-pt/30 rounded-md px-2 py-1">
      {label}
      <button
        type="button"
        aria-label={`Quitar ${label}`}
        onClick={onRemove}
        className="hover:bg-status-pt/10 rounded p-0.5"
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
      </button>
    </span>
  );
}

function PlantaSelect({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const { data: plantas } = usePlantas();
  return (
    <label className="inline-flex items-center gap-2 text-xs text-ink-muted">
      <span>Planta</span>
      <select
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? null : Number(v));
        }}
        className="h-8 px-2 pr-7 text-xs rounded-md border border-surface-border bg-white text-ink focus:outline-none focus:ring-2 focus:ring-status-pt/30 focus:border-status-pt/50 transition"
      >
        <option value="">Todas</option>
        {plantas?.map((p) => (
          <option key={p.idPlanta} value={p.idPlanta}>
            {p.NombrePlanta}
          </option>
        ))}
      </select>
    </label>
  );
}

function Stat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-subtle">
        {label}
      </div>
      <div
        className={`tabular-nums font-semibold ${
          emphasis ? "text-base text-ink" : "text-sm text-ink-muted"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ProcessBlock({
  bloque,
  selected,
  onClick,
}: {
  bloque: BloqueProceso;
  selected: boolean;
  onClick: () => void;
}) {
  const isNull = bloque.idProceso === null;
  const inventarioTotal =
    bloque.Disponibles + bloque.Recibidas + bloque.PorTransferir;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isNull}
      className={`group text-left rounded-lg border bg-white p-4 shadow-soft transition ${
        selected
          ? "border-status-pt ring-2 ring-status-pt/20"
          : "border-surface-border hover:border-status-pt/40 hover:shadow-card"
      } ${isNull ? "opacity-60 cursor-default" : "cursor-pointer"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3
          className="text-sm font-medium text-ink truncate"
          title={bloque.Proceso}
        >
          {bloque.Proceso}
        </h3>
        {selected ? (
          <span className="text-[10px] uppercase tracking-wide text-status-pt font-semibold shrink-0">
            filtrado
          </span>
        ) : null}
      </div>

      {/* Inventario total = Disponibles + Recibidas + PorTransferir */}
      <div className="mt-3">
        <div
          className="text-2xl font-semibold tabular-nums leading-tight text-ink"
          title={`${fmtInt(inventarioTotal)} piezas en el proceso`}
        >
          {fmtInt(inventarioTotal)}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-ink-subtle mt-0.5">
          Inventario total
        </div>
      </div>

      {/* Las 3 metricas principales (mutuamente excluyentes por etiqueta) */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric
          value={bloque.Disponibles}
          label="Disponibles"
          colorClass="text-status-covered"
        />
        <Metric
          value={bloque.Recibidas}
          label="Recibidas"
          colorClass="text-status-partial"
        />
        <Metric
          value={bloque.PorTransferir}
          label="Por transferir"
          colorClass="text-status-pt"
        />
      </div>

      {/* Meta: etiquetas, materiales, plantas */}
      <div className="mt-4 flex items-center gap-3 text-[11px] text-ink-subtle">
        <MetaInline value={bloque.Etiquetas} label="etiq." />
        <span aria-hidden="true">·</span>
        <MetaInline value={bloque.Materiales} label="mat." />
        <span aria-hidden="true">·</span>
        <MetaInline value={bloque.Plantas} label="plt." />
      </div>

      {/* Pie reservado siempre (alinea verticalmente todos los bloques) */}
      <div className="mt-2 pt-2 border-t border-surface-border flex items-center gap-1.5 text-[10px] min-h-[1.25rem]">
        {bloque.Inspeccion > 0 ? (
          <span className="inline-flex items-center gap-1 rounded px-1 py-px bg-status-empty/10 text-status-empty font-medium tabular-nums">
            <DotIcon className="w-1.5 h-1.5" />
            {fmtInt(bloque.Inspeccion)} insp.
          </span>
        ) : null}
        {bloque.Retrabajo > 0 ? (
          <span className="inline-flex items-center gap-1 rounded px-1 py-px bg-status-partial/10 text-status-partial font-medium tabular-nums">
            <DotIcon className="w-1.5 h-1.5" />
            {fmtInt(bloque.Retrabajo)} retrab.
          </span>
        ) : null}
      </div>
    </button>
  );
}

function Metric({
  value,
  label,
  colorClass,
}: {
  value: number;
  label: string;
  colorClass: string;
}) {
  return (
    <div className="min-w-0">
      <div
        className={`text-xl font-semibold tabular-nums leading-tight truncate ${colorClass}`}
        title={fmtInt(value)}
      >
        {fmtInt(value)}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-ink-subtle mt-0.5">
        {label}
      </div>
    </div>
  );
}

function MetaInline({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="tabular-nums font-medium text-ink-muted">
        {fmtInt(value)}
      </span>
      <span>{label}</span>
    </span>
  );
}

function DotIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 8 8"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <circle cx="4" cy="4" r="4" />
    </svg>
  );
}

function BloquesSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-surface-border bg-white p-4 shadow-soft animate-pulse"
        >
          <div className="h-4 w-2/3 rounded bg-surface-subtle" />
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div>
              <div className="h-6 w-12 rounded bg-surface-subtle" />
              <div className="h-2 w-10 rounded bg-surface-subtle mt-2" />
            </div>
            <div>
              <div className="h-6 w-12 rounded bg-surface-subtle" />
              <div className="h-2 w-10 rounded bg-surface-subtle mt-2" />
            </div>
            <div>
              <div className="h-6 w-12 rounded bg-surface-subtle" />
              <div className="h-2 w-10 rounded bg-surface-subtle mt-2" />
            </div>
          </div>
          <div className="mt-4 h-2.5 w-1/2 rounded bg-surface-subtle" />
        </div>
      ))}
    </div>
  );
}
