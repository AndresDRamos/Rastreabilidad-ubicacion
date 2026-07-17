import { useMemo } from "react";

import { useBloques } from "@/api/queries";
import type { BloqueBucket, BloqueProceso, ResumenMode } from "@/api/types";
import {
  BucketBadge,
  BucketMetric,
  BucketRow,
  Chevron,
} from "@/components/ui/BucketRow";
import { fmtInt } from "@/lib/format";
import { useUiStore } from "@/store/useUiStore";
import { EtiquetasDrawer } from "./EtiquetasDrawer";
import { FlujoCanvas } from "./FlujoCanvas";
import { FlujoPlantasCanvas } from "./FlujoPlantasCanvas";
import { TipoMaterialSelect } from "./TipoMaterialSelect";

export function SummaryView() {
  const clienteIds = useUiStore((s) => s.filters.clienteIds);
  const ciudadIds = useUiStore((s) => s.filters.ciudadIds);
  const tipoMaterialIds = useUiStore((s) => s.filters.tipoMaterialIds);
  const claseIds = useUiStore((s) => s.filters.claseIds);
  const universo = useUiStore((s) => s.universo);
  const resumenMode = useUiStore((s) => s.resumenMode);
  const setResumenMode = useUiStore((s) => s.setResumenMode);
  const setFilter = useUiStore((s) => s.setFilter);
  // El inventario ya no se filtra por planta: las tarjetas se agrupan por planta.
  const { data: bloques, isLoading, error, isFetching } = useBloques(
    clienteIds,
    null,
    ciudadIds,
    tipoMaterialIds,
    claseIds,
    universo,
  );
  const procesoFiltro = useUiStore((s) => s.procesoFiltro);
  const setProcesoFiltro = useUiStore((s) => s.setProcesoFiltro);
  const setBloqueDetalle = useUiStore((s) => s.setBloqueDetalle);
  const plantasColapsadas = useUiStore((s) => s.plantasColapsadas);
  const togglePlantaColapsada = useUiStore((s) => s.togglePlantaColapsada);
  const flujoPlantaDrill = useUiStore((s) => s.flujoPlantaDrill);

  // Agrupa los bloques por planta y ordena las secciones por nombre de planta.
  // Dentro de cada planta, los bloques ya vienen ordenados por inventario DESC.
  const grupos = useMemo(() => {
    if (!bloques) return [] as { idPlanta: number | null; nombre: string; bloques: BloqueProceso[] }[];
    const map = new Map<number | null, { idPlanta: number | null; nombre: string; bloques: BloqueProceso[] }>();
    for (const b of bloques) {
      const key = b.idPlanta;
      let g = map.get(key);
      if (!g) {
        g = {
          idPlanta: key,
          nombre: b.NombrePlanta ?? "(sin planta)",
          bloques: [],
        };
        map.set(key, g);
      }
      g.bloques.push(b);
    }
    return [...map.values()].sort((a, b) =>
      a.nombre.localeCompare(b.nombre, "es", { numeric: true }),
    );
  }, [bloques]);

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
    <div className="h-full flex flex-col bg-surface-muted">
      {/* La cabecera es solo para la vista de tarjetas. En Flujo, los controles
          viven como overlays sobre el lienzo (arriba-izq filtros, arriba-der el
          toggle) para no robar altura vertical. */}
      {resumenMode === "cards" ? (
        <header className="shrink-0 bg-white border-b border-surface-border px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-base font-semibold text-ink">Inventario por proceso</h2>
            <div className="flex items-center gap-4 text-right shrink-0">
              <ResumenModeToggle value={resumenMode} onChange={setResumenMode} />
              {bloques ? (
                <>
                  <Stat label="Procesos" value={fmtInt(totales.procesos)} />
                  <Stat label="Etiquetas" value={fmtInt(totales.etiquetas)} />
                  <Stat label="Piezas" value={fmtInt(totales.piezas)} emphasis />
                </>
              ) : null}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <TipoMaterialSelect
              value={tipoMaterialIds}
              onChange={(v) => setFilter("tipoMaterialIds", v)}
            />
            {clienteIds.length > 0 ? (
              <FilterChip
                label={
                  clienteIds.length === 1 ? "1 cliente" : `${clienteIds.length} clientes`
                }
                onRemove={() => setFilter("clienteIds", [])}
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
      ) : null}

      {resumenMode === "flujo" ? (
        <div className="relative flex-1 min-h-0">
          <div className="absolute right-3 top-3 z-20">
            <ResumenModeToggle value={resumenMode} onChange={setResumenMode} />
          </div>
          {flujoPlantaDrill ? (
            <FlujoCanvas planta={flujoPlantaDrill.idPlanta} />
          ) : (
            <FlujoPlantasCanvas />
          )}
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto p-6">
        {showSkeleton ? (
          <BloquesSkeleton />
        ) : error ? (
          <div className="text-sm text-status-empty">
            Error al cargar: {(error as Error).message}
          </div>
        ) : grupos.length === 0 ? (
          <div className="text-sm text-ink-muted">
            Sin WIP activo con los filtros actuales.
          </div>
        ) : (
          <div className="space-y-6">
            {grupos.map((g) => {
              const colapsada =
                g.idPlanta !== null && plantasColapsadas.has(g.idPlanta);
              return (
                <PlantaSection
                  key={g.idPlanta ?? "null"}
                  nombre={g.nombre}
                  count={g.bloques.length}
                  colapsada={colapsada}
                  onToggle={() => {
                    if (g.idPlanta !== null) togglePlantaColapsada(g.idPlanta);
                  }}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {g.bloques.map((b) => (
                      <ProcessBlock
                        key={`${b.idProceso ?? `null-${b.Proceso}`}-${b.idPlanta ?? "x"}`}
                        bloque={b}
                        selected={
                          procesoFiltro !== null &&
                          b.idProceso !== null &&
                          b.idProceso === procesoFiltro.idProceso &&
                          b.idPlanta === procesoFiltro.idPlanta
                        }
                        onClick={() => {
                          if (b.idProceso === null) return;
                          if (
                            procesoFiltro !== null &&
                            procesoFiltro.idProceso === b.idProceso &&
                            procesoFiltro.idPlanta === b.idPlanta
                          ) {
                            setProcesoFiltro(null);
                          } else {
                            setProcesoFiltro({
                              idProceso: b.idProceso,
                              nombre: b.Proceso,
                              idPlanta: b.idPlanta,
                              nombrePlanta: b.NombrePlanta,
                            });
                          }
                        }}
                        onOpenDetail={(bucket) => {
                          if (b.idProceso === null) return;
                          setBloqueDetalle({
                            idProceso: b.idProceso,
                            nombreProceso: b.Proceso,
                            bucket,
                            idPlanta: b.idPlanta,
                          });
                        }}
                      />
                    ))}
                  </div>
                </PlantaSection>
              );
            })}
          </div>
        )}
      </div>
      )}
      <EtiquetasDrawer />
    </div>
  );
}

function ResumenModeToggle({
  value,
  onChange,
}: {
  value: ResumenMode;
  onChange: (m: ResumenMode) => void;
}) {
  const opts: { value: ResumenMode; label: string }[] = [
    { value: "cards", label: "Tarjetas" },
    { value: "flujo", label: "Flujo" },
  ];
  return (
    <div className="inline-flex items-center p-0.5 rounded-md bg-surface-muted border border-surface-border">
      {opts.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`px-2.5 py-1 text-xs font-medium rounded transition ${
              active
                ? "bg-white text-status-pt shadow-soft border border-status-pt/30"
                : "text-ink-muted hover:text-ink border border-transparent"
            }`}
          >
            {o.label}
          </button>
        );
      })}
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

/** Seccion colapsable de una planta: cabecera con chevron + tarjetas debajo. */
function PlantaSection({
  nombre,
  count,
  colapsada,
  onToggle,
  children,
}: {
  nombre: string;
  count: number;
  colapsada: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!colapsada}
        className="w-full flex items-center gap-2 py-2 text-left group"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform ${
            colapsada ? "" : "rotate-90"
          }`}
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <h3 className="text-sm font-semibold text-ink shrink-0">{nombre}</h3>
        <span className="text-[11px] tabular-nums text-ink-subtle">
          {fmtInt(count)} {count === 1 ? "proceso" : "procesos"}
        </span>
        <span className="flex-1 h-px bg-surface-border ml-1" aria-hidden="true" />
      </button>
      {colapsada ? null : <div className="mt-1">{children}</div>}
    </section>
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
  onOpenDetail,
}: {
  bloque: BloqueProceso;
  selected: boolean;
  onClick: () => void;
  onOpenDetail: (bucket: BloqueBucket) => void;
}) {
  const isNull = bloque.idProceso === null;

  const handleBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isNull) return;
    // Si el click vino de un boton interno (Metric/badge), no togglear el filtro.
    const target = e.target as HTMLElement;
    if (target.closest("[data-bucket-button]")) return;
    onClick();
  };

  return (
    <div
      role={isNull ? undefined : "button"}
      tabIndex={isNull ? undefined : 0}
      onClick={handleBodyClick}
      onKeyDown={(e) => {
        if (isNull) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-pressed={selected}
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

      {/* Fila direccional (coherente con el nodo de Flujo): el material avanza
          Disponibles -> Recibidas -> Por transferir. Recibidas es el numero
          principal; los flancos son las entradas/salidas. */}
      <BucketRow className="mt-3">
        <BucketMetric
          value={bloque.Disponibles}
          bucket="Disponibles"
          size="sm"
          onClick={() => onOpenDetail("Disponibles")}
          disabled={isNull}
        />
        <Chevron />
        <BucketMetric
          value={bloque.Recibidas}
          bucket="Recibidas"
          size="lg"
          onClick={() => onOpenDetail("Recibidas")}
          disabled={isNull}
        />
        <Chevron />
        <BucketMetric
          value={bloque.PorTransferir}
          bucket="PorTransferir"
          size="sm"
          onClick={() => onOpenDetail("PorTransferir")}
          disabled={isNull}
        />
      </BucketRow>

      {/* Meta: etiquetas, materiales */}
      <div className="mt-3 flex items-center justify-center gap-3 text-[11px] text-ink-subtle">
        <MetaInline value={bloque.Etiquetas} label="etiq." />
        <span aria-hidden="true">·</span>
        <MetaInline value={bloque.Materiales} label="mat." />
      </div>

      {/* Pie reservado siempre (alinea verticalmente todos los bloques) */}
      <div className="mt-2 pt-2 border-t border-surface-border flex items-center justify-center gap-1.5 min-h-[1.25rem]">
        {bloque.Inspeccion > 0 ? (
          <BucketBadge
            value={bloque.Inspeccion}
            bucket="Inspeccion"
            onClick={() => onOpenDetail("Inspeccion")}
          />
        ) : null}
        {bloque.Retrabajo > 0 ? (
          <BucketBadge
            value={bloque.Retrabajo}
            bucket="Retrabajo"
            onClick={() => onOpenDetail("Retrabajo")}
          />
        ) : null}
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
