import { useEffect, useMemo, useRef, useState } from "react";

import { usePts } from "@/api/queries";
import { ALCANCES, useUiStore } from "@/store/useUiStore";
import { CiudadMultiSelect } from "./CiudadMultiSelect";
import { ClaseMultiSelect } from "./ClaseMultiSelect";
import { ClienteMultiSelect } from "./ClienteMultiSelect";
import { NumeroParteMultiSelect } from "./NumeroParteMultiSelect";

/** Alcance temporal de la demanda: cuatro cortes fijos en vez de una fecha libre.
 *  El corte es por fecha de PROMESA. Ver el comentario de `Alcance` en el store
 *  para por que el preset mas corto es 4 semanas y no la semana en curso. */
function AlcanceSelector() {
  const alcance = useUiStore((s) => s.alcance);
  const setAlcance = useUiStore((s) => s.setAlcance);
  return (
    <div>
      <span className="block text-xs text-ink-muted mb-1">Alcance del requerimiento</span>
      <div className="grid grid-cols-2 gap-1">
        {ALCANCES.map((a) => {
          const activo = a.id === alcance;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setAlcance(a.id)}
              title={a.ayuda}
              aria-pressed={activo}
              className={`h-9 px-2 text-xs font-medium rounded-md border transition focus:outline-none focus:ring-2 focus:ring-status-pt/30 ${
                activo
                  ? "border-status-pt/50 bg-status-pt/10 text-status-pt"
                  : "border-surface-border bg-white text-ink-muted hover:bg-surface-subtle hover:text-ink"
              }`}
            >
              {a.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FiltersHeader() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const badges = useFilterBadges();
  const hasFilters = badges.length > 0;

  // Cerrar al click fuera del boton/panel.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Cerrar con Escape y devolver el foco al boton.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative border-b border-surface-border">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="filters-panel"
        title={open ? "Cerrar filtros" : "Abrir filtros"}
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
        <Chevron up={open} />
      </button>

      {open ? (
        <div
          ref={panelRef}
          id="filters-panel"
          role="dialog"
          aria-label="Filtros"
          className="absolute left-4 right-4 top-full z-40 mt-1 origin-top rounded-lg border border-surface-border bg-white p-3 shadow-card animate-popover-in space-y-2"
        >
          <ClienteMultiSelect />
          <CiudadMultiSelect />
          <ClaseMultiSelect />
          <NumeroParteMultiSelect />
          <AlcanceSelector />
        </div>
      ) : null}
    </div>
  );
}

interface Badge {
  label: string;
  value: string;
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
 * Ya NO se renderizan como lista dentro del panel (solo alimentan el
 * contador numerico del boton "Filtros"). Resuelve nombres de
 * cliente/ciudad/clase/PT desde el cache de usePts (mismo dataset que
 * alimenta los multi-selects, asi que ya esta en memoria).
 */
function useFilterBadges(): Badge[] {
  const ventana = useUiStore((s) => s.ventana);
  const fechaMax = useUiStore((s) => s.filters.fechaMax);
  const alcance = useUiStore((s) => s.alcance);
  const clienteIds = useUiStore((s) => s.filters.clienteIds);
  const ciudadIds = useUiStore((s) => s.filters.ciudadIds);
  const claseIds = useUiStore((s) => s.filters.claseIds);
  const ptIds = useUiStore((s) => s.filters.ptIds);

  const { data: filas } = usePts(ventana, fechaMax);

  return useMemo(() => {
    const clienteMap = new Map<number, string>();
    const ciudadMap = new Map<number, string>();
    const claseMap = new Map<number, string>();
    const ptMap = new Map<number, string>();
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
        if (!ptMap.has(f.idMaterial)) {
          ptMap.set(f.idMaterial, f.PT);
        }
      }
    }

    const badges: Badge[] = [];

    if (clienteIds.length > 0) {
      const names = clienteIds
        .map((id) => clienteMap.get(id) ?? `#${id}`)
        .sort((a, b) => a.localeCompare(b, "es-MX"));
      badges.push({
        label: clienteIds.length === 1 ? "Cliente" : `Clientes (${clienteIds.length})`,
        value: names.join(", "),
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
    if (ptIds.length > 0) {
      const names = ptIds
        .map((id) => ptMap.get(id) ?? `#${id}`)
        .sort((a, b) => a.localeCompare(b, "es-MX"));
      badges.push({
        label: ptIds.length === 1 ? "Numero parte" : `Numeros de parte (${ptIds.length})`,
        value: names.join(", "),
      });
    }
    // El alcance siempre esta puesto; solo cuenta como "filtro activo" cuando se
    // aparta del default de 3 meses.
    if (alcance !== "3meses") {
      const a = ALCANCES.find((x) => x.id === alcance);
      badges.push({ label: "Alcance", value: a?.label ?? alcance });
    }

    return badges;
  }, [filas, clienteIds, ciudadIds, claseIds, ptIds, alcance]);
}
