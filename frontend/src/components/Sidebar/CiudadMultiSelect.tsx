import { useEffect, useMemo, useRef, useState } from "react";

import { usePts } from "@/api/queries";
import { useUiStore } from "@/store/useUiStore";

/**
 * Multi-select de ciudades derivado de los PTs con demanda activa.
 * Si hay clienteId fijado, restringe las opciones a las ciudades de ese cliente.
 *
 * Almacena `ciudadIds: number[]` en el store. El backend recibe el CSV
 * `?ciudades=137,737` para acotar el universo de Q_bloques / Q_pts_en_proceso.
 */
export function CiudadMultiSelect() {
  const ventana = useUiStore((s) => s.ventana);
  const fechaMax = useUiStore((s) => s.filters.fechaMax);
  const clienteId = useUiStore((s) => s.filters.clienteId);
  const ciudadIds = useUiStore((s) => s.filters.ciudadIds);
  const setFilter = useUiStore((s) => s.setFilter);
  const { data: filas } = usePts(ventana, fechaMax);

  const opciones = useMemo(() => {
    if (!filas) return [] as { id: number; nombre: string }[];
    const seen = new Map<number, string>();
    for (const f of filas) {
      if (clienteId != null && f.idCliente !== clienteId) continue;
      if (f.idCiudad != null && !seen.has(f.idCiudad)) {
        seen.set(f.idCiudad, f.Ciudad);
      }
    }
    return Array.from(seen.entries())
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es-MX"));
  }, [filas, clienteId]);

  // Cuando cambia el cliente (o el universo de PTs), quitar del filtro las
  // ciudades que ya no aplican. NO correr mientras filas esta cargando: en
  // ese momento opciones=[] y borrariamos la seleccion del usuario.
  useEffect(() => {
    if (!filas) return;
    if (ciudadIds.length === 0) return;
    const validIds = new Set(opciones.map((o) => o.id));
    const next = ciudadIds.filter((id) => validIds.has(id));
    if (next.length !== ciudadIds.length) {
      setFilter("ciudadIds", next);
    }
  }, [filas, opciones, ciudadIds, setFilter]);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const filtradas = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return opciones;
    return opciones.filter((o) => o.nombre.toLowerCase().includes(q));
  }, [opciones, query]);

  const placeholder =
    ciudadIds.length === 0
      ? "Ciudad"
      : ciudadIds.length === 1
        ? opciones.find((o) => o.id === ciudadIds[0])?.nombre ?? "1 ciudad"
        : `${ciudadIds.length} ciudades`;

  // Solo mostrar el selector cuando hay un cliente seleccionado Y ese cliente
  // tiene mas de un destino. Sin cliente, no aparece. Mientras `filas` carga
  // el componente queda montado para no perder la seleccion previa.
  if (clienteId == null) return null;
  if (filas && opciones.length <= 1) return null;

  function toggle(id: number) {
    if (ciudadIds.includes(id)) {
      setFilter(
        "ciudadIds",
        ciudadIds.filter((x) => x !== id),
      );
    } else {
      setFilter("ciudadIds", [...ciudadIds, id]);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          type="text"
          placeholder={placeholder}
          value={open ? query : ""}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          className={`w-full h-9 pl-3 pr-7 text-sm rounded-md border border-surface-border bg-white text-ink focus:outline-none focus:ring-2 focus:ring-status-pt/30 focus:border-status-pt/50 transition ${
            ciudadIds.length > 0 && !open
              ? "placeholder:text-ink"
              : "placeholder:text-ink-subtle"
          }`}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {ciudadIds.length > 0 ? (
          <button
            type="button"
            aria-label="Limpiar ciudades"
            onClick={() => {
              setFilter("ciudadIds", []);
              setQuery("");
              setOpen(false);
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-ink-subtle hover:text-ink rounded"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-3 h-3"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        ) : null}
      </div>

      {open && opciones.length > 0 ? (
        <ul
          className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-surface-border bg-white shadow-card"
          role="listbox"
          aria-multiselectable="true"
        >
          {filtradas.slice(0, 80).map((o) => {
            const isSelected = ciudadIds.includes(o.id);
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => toggle(o.id)}
                  className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-surface-subtle transition ${
                    isSelected ? "bg-status-pt/5 text-ink" : "text-ink"
                  }`}
                  role="option"
                  aria-selected={isSelected}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    readOnly
                    className="h-3.5 w-3.5 rounded border-surface-border text-status-pt accent-status-pt"
                  />
                  <span className="flex-1 truncate">{o.nombre}</span>
                </button>
              </li>
            );
          })}
          {filtradas.length === 0 ? (
            <li className="px-3 py-1.5 text-xs text-ink-subtle italic">
              Sin coincidencias
            </li>
          ) : filtradas.length > 80 ? (
            <li className="px-3 py-1.5 text-xs text-ink-subtle italic">
              +{filtradas.length - 80} mas... refina tu busqueda
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
