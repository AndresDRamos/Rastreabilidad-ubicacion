import { useEffect, useMemo, useRef, useState } from "react";

import { usePts } from "@/api/queries";
import { useUiStore } from "@/store/useUiStore";

/**
 * Multi-select de clientes derivado de los PTs con demanda activa.
 *
 * Almacena `clienteIds: number[]` en el store. El backend recibe el CSV
 * `?clientes=6,8` para acotar el universo de Q_bloques / Q_pts_en_proceso.
 */
export function ClienteMultiSelect() {
  const ventana = useUiStore((s) => s.ventana);
  const fechaMax = useUiStore((s) => s.filters.fechaMax);
  const clienteIds = useUiStore((s) => s.filters.clienteIds);
  const setFilter = useUiStore((s) => s.setFilter);
  const { data: filas } = usePts(ventana, fechaMax);

  const opciones = useMemo(() => {
    if (!filas) return [] as { id: number; nombre: string }[];
    const seen = new Map<number, string>();
    for (const f of filas) {
      if (f.idCliente != null && !seen.has(f.idCliente)) {
        seen.set(f.idCliente, f.Cliente);
      }
    }
    return Array.from(seen.entries())
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es-MX"));
  }, [filas]);

  // Cuando cambia el universo de PTs, quitar del filtro los clientes que ya
  // no aparecen. No correr mientras `filas` carga (opciones=[] borraria todo).
  useEffect(() => {
    if (!filas) return;
    if (clienteIds.length === 0) return;
    const validIds = new Set(opciones.map((o) => o.id));
    const next = clienteIds.filter((id) => validIds.has(id));
    if (next.length !== clienteIds.length) {
      setFilter("clienteIds", next);
    }
  }, [filas, opciones, clienteIds, setFilter]);

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
    clienteIds.length === 0
      ? "Cliente"
      : clienteIds.length === 1
        ? opciones.find((o) => o.id === clienteIds[0])?.nombre ?? "1 cliente"
        : `${clienteIds.length} clientes`;

  function toggle(id: number) {
    if (clienteIds.includes(id)) {
      setFilter(
        "clienteIds",
        clienteIds.filter((x) => x !== id),
      );
    } else {
      setFilter("clienteIds", [...clienteIds, id]);
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
            clienteIds.length > 0 && !open
              ? "placeholder:text-ink"
              : "placeholder:text-ink-subtle"
          }`}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {clienteIds.length > 0 ? (
          <button
            type="button"
            aria-label="Limpiar clientes"
            onClick={() => {
              setFilter("clienteIds", []);
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
            const isSelected = clienteIds.includes(o.id);
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
