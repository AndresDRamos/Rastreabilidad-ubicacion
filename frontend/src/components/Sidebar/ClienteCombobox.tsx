import { useEffect, useMemo, useRef, useState } from "react";

import { usePts } from "@/api/queries";
import { useUiStore } from "@/store/useUiStore";

/**
 * Combobox de clientes derivado de los PTs con demanda activa.
 * Almacena `clienteId` (number | null) en el store, no el nombre.
 */
export function ClienteCombobox() {
  const ventana = useUiStore((s) => s.ventana);
  const fechaMax = useUiStore((s) => s.filters.fechaMax);
  const clienteId = useUiStore((s) => s.filters.clienteId);
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

  const nombreSeleccionado = useMemo(() => {
    if (clienteId == null) return "";
    return opciones.find((o) => o.id === clienteId)?.nombre ?? "";
  }, [clienteId, opciones]);

  const [query, setQuery] = useState(nombreSeleccionado);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Si cambia el cliente seleccionado desde afuera, sincronizar el input.
  useEffect(() => {
    setQuery(nombreSeleccionado);
  }, [nombreSeleccionado]);

  // Cerrar al click fuera.
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
    if (!q || q === nombreSeleccionado.toLowerCase()) return opciones;
    return opciones.filter((o) => o.nombre.toLowerCase().includes(q));
  }, [opciones, query, nombreSeleccionado]);

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <input
          type="text"
          placeholder="Cliente"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Limpiar seleccion en cuanto el usuario empieza a editar.
            if (clienteId !== null) setFilter("clienteId", null);
          }}
          onFocus={() => setOpen(true)}
          className="w-full h-9 pl-3 pr-7 text-sm rounded-md border border-surface-border bg-white text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-status-pt/30 focus:border-status-pt/50 transition"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {clienteId !== null || query ? (
          <button
            type="button"
            aria-label="Limpiar cliente"
            onClick={() => {
              setQuery("");
              setFilter("clienteId", null);
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

      {open && filtradas.length > 0 ? (
        <ul
          className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-surface-border bg-white shadow-card"
          role="listbox"
        >
          {filtradas.slice(0, 50).map((o) => {
            const isSelected = o.id === clienteId;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    setFilter("clienteId", o.id);
                    setQuery(o.nombre);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface-subtle transition ${
                    isSelected ? "bg-status-pt/10 text-status-pt" : "text-ink"
                  }`}
                  role="option"
                  aria-selected={isSelected}
                >
                  {o.nombre}
                </button>
              </li>
            );
          })}
          {filtradas.length > 50 ? (
            <li className="px-3 py-1.5 text-xs text-ink-subtle italic">
              +{filtradas.length - 50} mas... refina tu busqueda
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
