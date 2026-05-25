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
  const setFilter = useUiStore((s) => s.setFilter);
  const { data: bloques, isLoading, error, isFetching } = useBloques(
    clienteId,
    plantaId,
    ciudadIds,
    tipoMaterialIds,
  );
  const procesoFiltro = useUiStore((s) => s.procesoFiltro);
  const setProcesoFiltro = useUiStore((s) => s.setProcesoFiltro);

  const totales = useMemo(() => {
    if (!bloques) return { piezas: 0, etiquetas: 0, procesos: 0 };
    let piezas = 0;
    let etiquetas = 0;
    for (const b of bloques) {
      piezas += b.Piezas;
      etiquetas += b.Etiquetas;
    }
    return { piezas, etiquetas, procesos: bloques.length };
  }, [bloques]);

  return (
    <div className="h-full overflow-y-auto bg-surface-muted">
      <header className="bg-white border-b border-surface-border px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">
              Inventario por proceso destino
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
          {isFetching && !isLoading ? (
            <span className="text-[11px] text-ink-subtle">actualizando...</span>
          ) : null}
        </div>
      </header>

      <div className="p-6">
        {isLoading ? (
          <div className="text-sm text-ink-muted">Cargando bloques...</div>
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
            {bloques.map((b) => (
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
      <div className="mt-3 text-2xl font-semibold tabular-nums text-ink">
        {fmtInt(bloque.Piezas)}
      </div>
      <div className="text-[11px] text-ink-subtle">piezas</div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-ink-muted">
        <Meta value={fmtInt(bloque.Etiquetas)} label="etiq." />
        <Meta value={fmtInt(bloque.Componentes)} label="comp." />
        <Meta value={fmtInt(bloque.Plantas)} label="plt." />
      </div>
    </button>
  );
}

function Meta({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="tabular-nums font-medium text-ink">{value}</span>
      <span className="text-[10px] text-ink-subtle">{label}</span>
    </div>
  );
}
