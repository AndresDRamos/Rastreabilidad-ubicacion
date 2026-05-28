import { useMemo, useState } from "react";

import { usePts } from "@/api/queries";
import { useUiStore } from "@/store/useUiStore";
import { CiudadMultiSelect } from "./CiudadMultiSelect";
import { ClaseMultiSelect } from "./ClaseMultiSelect";
import { ClienteCombobox } from "./ClienteCombobox";

export function FiltersHeader() {
  const filters = useUiStore((s) => s.filters);
  const setFilter = useUiStore((s) => s.setFilter);
  const [collapsed, setCollapsed] = useState(false);

  const badges = useFilterBadges();
  const hasFilters = badges.length > 0;

  return (
    <div className="border-b border-surface-border">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-controls="filters-panel"
        title={collapsed ? "Expandir filtros" : "Colapsar filtros"}
        className="w-full flex items-center justify-between px-4 pt-3 pb-2 text-xs font-medium text-ink-muted hover:text-ink transition focus:outline-none"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="uppercase tracking-wide">Filtros</span>
          {hasFilters ? (
            <span className="inline-flex items-center justify-center min-w-[1rem] h-4 px-1 text-[10px] font-semibold text-status-pt bg-status-pt/10 rounded-full">
              {badges.length}
            </span>
          ) : null}
        </span>
        <Chevron up={!collapsed} />
      </button>

      {collapsed ? (
        <div id="filters-panel" className="px-4 pb-3">
          {hasFilters ? (
            <div className="flex flex-wrap gap-1.5">
              {badges.map((b) => (
                <FilterBadge key={b.label} label={b.label} value={b.value} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-subtle italic">Sin filtros aplicados</p>
          )}
        </div>
      ) : (
        <div id="filters-panel" className="px-4 pb-3 space-y-2">
          <ClienteCombobox />
          <CiudadMultiSelect />
          <ClaseMultiSelect />
          <Input
            placeholder="Numero de parte"
            value={filters.pt}
            onChange={(v) => setFilter("pt", v)}
          />
          <div>
            <label className="flex items-center justify-between text-xs text-ink-muted mb-1">
              <span>Fecha promesa hasta</span>
              {filters.fechaMax ? (
                <button
                  type="button"
                  onClick={() => setFilter("fechaMax", "")}
                  className="text-status-pt hover:underline focus:outline-none"
                >
                  limpiar
                </button>
              ) : null}
            </label>
            <input
              type="date"
              value={filters.fechaMax}
              onChange={(e) => setFilter("fechaMax", e.target.value)}
              className={`w-full h-9 px-3 text-sm rounded-md border border-surface-border bg-white focus:outline-none focus:ring-2 focus:ring-status-pt/30 focus:border-status-pt/50 transition ${
                filters.fechaMax ? "text-ink" : "text-ink-subtle"
              }`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Input({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-9 px-3 text-sm rounded-md border border-surface-border bg-white text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-status-pt/30 focus:border-status-pt/50 transition"
    />
  );
}

interface Badge {
  label: string;
  value: string;
}

function FilterBadge({ label, value }: Badge) {
  return (
    <div
      title={`${label}: ${value}`}
      className="inline-flex flex-col min-w-0 max-w-full rounded-md border border-surface-border bg-surface-muted px-2 py-1 leading-tight"
    >
      <span className="text-[9px] uppercase tracking-wide text-ink-subtle">
        {label}
      </span>
      <span className="text-xs text-ink truncate">{value}</span>
    </div>
  );
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-3.5 h-3.5 transition-transform ${up ? "" : "rotate-180"}`}
      aria-hidden="true"
    >
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

/**
 * Construye la lista de badges para los filtros activos del sidebar.
 * Resuelve nombres de cliente/ciudad/clase desde el cache de usePts (mismo
 * dataset que alimenta los multi-selects, asi que ya esta en memoria).
 */
function useFilterBadges(): Badge[] {
  const ventana = useUiStore((s) => s.ventana);
  const fechaMax = useUiStore((s) => s.filters.fechaMax);
  const clienteId = useUiStore((s) => s.filters.clienteId);
  const ciudadIds = useUiStore((s) => s.filters.ciudadIds);
  const claseIds = useUiStore((s) => s.filters.claseIds);
  const pt = useUiStore((s) => s.filters.pt);

  const { data: filas } = usePts(ventana, fechaMax);

  return useMemo(() => {
    const clienteMap = new Map<number, string>();
    const ciudadMap = new Map<number, string>();
    const claseMap = new Map<number, string>();
    if (filas) {
      for (const f of filas) {
        if (f.idCliente != null && !clienteMap.has(f.idCliente)) {
          clienteMap.set(f.idCliente, f.Cliente);
        }
        if (f.idCiudad != null && !ciudadMap.has(f.idCiudad)) {
          ciudadMap.set(f.idCiudad, f.Ciudad);
        }
        if (f.idClase != null && f.Clase != null && !claseMap.has(f.idClase)) {
          claseMap.set(f.idClase, f.Clase);
        }
      }
    }

    const badges: Badge[] = [];

    if (clienteId != null) {
      badges.push({
        label: "Cliente",
        value: clienteMap.get(clienteId) ?? `#${clienteId}`,
      });
    }
    if (ciudadIds.length > 0) {
      const names = ciudadIds
        .map((id) => ciudadMap.get(id) ?? `#${id}`)
        .sort((a, b) => a.localeCompare(b, "es-MX"));
      badges.push({
        label: ciudadIds.length === 1 ? "Ciudad" : `Ciudades (${ciudadIds.length})`,
        value: names.join(", "),
      });
    }
    if (claseIds.length > 0) {
      const names = claseIds
        .map((id) => claseMap.get(id) ?? `#${id}`)
        .sort((a, b) => a.localeCompare(b, "es-MX"));
      badges.push({
        label: claseIds.length === 1 ? "Clase" : `Clases (${claseIds.length})`,
        value: names.join(", "),
      });
    }
    if (pt.trim()) {
      badges.push({ label: "Numero parte", value: pt.trim() });
    }
    if (fechaMax) {
      badges.push({ label: "Fecha hasta", value: fechaMax });
    }

    return badges;
  }, [filas, clienteId, ciudadIds, claseIds, pt, fechaMax]);
}
