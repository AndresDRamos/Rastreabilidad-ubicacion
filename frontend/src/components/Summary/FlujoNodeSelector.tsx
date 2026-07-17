import { useEffect, useMemo, useRef, useState } from "react";
import type { Node } from "@xyflow/react";

import type { FlujoNodeData } from "@/lib/buildFlujo";
import { fmtInt } from "@/lib/format";

/** Normaliza para match difuso: minúsculas sin acentos. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

interface ProcAgg {
  nombre: string;
  idProceso: number | null;
  nodos: number;
  recibidas: number;
  disponibles: number;
  inspeccion: number;
  retrabajo: number;
}

/** Selector multi-nodo del Flujo: resalta (no filtra) los nodos de proceso cuyo
 *  nombre coincide, con match aproximado. Sirve para ver, p. ej., todos los
 *  "Almacen wip" a la vez y abrir su detalle. */
export function FlujoNodeSelector({
  nodes,
  value,
  onChange,
  onOpenDetail,
}: {
  nodes: Node<FlujoNodeData>[];
  value: string[];
  onChange: (names: string[]) => void;
  onOpenDetail: (idProceso: number, nombre: string) => void;
}) {
  // Agrega los nodos de proceso por NOMBRE (une fases y sub-plantas).
  const porNombre = useMemo(() => {
    const map = new Map<string, ProcAgg>();
    for (const n of nodes) {
      const d = n.data;
      if (d.esPuerta) continue;
      const key = d.proceso;
      let a = map.get(key);
      if (!a) {
        a = { nombre: key, idProceso: d.idProceso, nodos: 0, recibidas: 0, disponibles: 0, inspeccion: 0, retrabajo: 0 };
        map.set(key, a);
      }
      a.nodos += 1;
      a.recibidas += d.recibidas;
      a.disponibles += d.disponiblesEntrantes;
      a.inspeccion += d.inspeccion;
      a.retrabajo += d.retrabajo;
      if (a.idProceso == null && d.idProceso != null) a.idProceso = d.idProceso;
    }
    return [...map.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es-MX"));
  }, [nodes]);

  const seleccionadas = useMemo(() => {
    const set = new Set(value.map(norm));
    return porNombre.filter((p) => set.has(norm(p.nombre)));
  }, [porNombre, value]);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as globalThis.Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const filtradas = useMemo(() => {
    const q = norm(query);
    if (!q) return porNombre;
    // Difuso: todos los tokens del query aparecen como subcadena del nombre.
    const tokens = q.split(/\s+/).filter(Boolean);
    return porNombre.filter((p) => {
      const n = norm(p.nombre);
      return tokens.every((t) => n.includes(t));
    });
  }, [porNombre, query]);

  function toggle(nombre: string) {
    const exists = value.some((v) => norm(v) === norm(nombre));
    if (exists) onChange(value.filter((v) => norm(v) !== norm(nombre)));
    else onChange([...value, nombre]);
  }

  const placeholder =
    value.length === 0 ? "Resaltar procesos…" : `${value.length} resaltado${value.length === 1 ? "" : "s"}`;

  return (
    <div ref={wrapRef} className="relative w-64">
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
          className={`w-full h-8 pl-3 pr-7 text-xs rounded-md border border-surface-border bg-white text-ink shadow-soft focus:outline-none focus:ring-2 focus:ring-status-pt/30 focus:border-status-pt/50 transition ${
            value.length > 0 && !open ? "placeholder:text-ink font-medium" : "placeholder:text-ink-subtle"
          }`}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {value.length > 0 ? (
          <button
            type="button"
            aria-label="Limpiar resaltados"
            onClick={() => {
              onChange([]);
              setQuery("");
              setOpen(false);
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-ink-subtle hover:text-ink rounded"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        ) : null}
      </div>

      {open ? (
        <ul className="absolute z-30 mt-1 w-64 max-h-60 overflow-y-auto rounded-md border border-surface-border bg-white shadow-card" role="listbox" aria-multiselectable="true">
          {filtradas.slice(0, 60).map((p) => {
            const isSel = value.some((v) => norm(v) === norm(p.nombre));
            return (
              <li key={p.nombre}>
                <button
                  type="button"
                  onClick={() => toggle(p.nombre)}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-surface-subtle transition ${isSel ? "bg-status-pt/5" : ""}`}
                  role="option"
                  aria-selected={isSel}
                >
                  <input type="checkbox" checked={isSel} readOnly className="h-3.5 w-3.5 rounded border-surface-border accent-status-pt" />
                  <span className="flex-1 truncate text-ink">{p.nombre}</span>
                  {p.nodos > 1 ? <span className="text-[10px] text-ink-subtle shrink-0">{p.nodos} nodos</span> : null}
                </button>
              </li>
            );
          })}
          {filtradas.length === 0 ? (
            <li className="px-3 py-1.5 text-xs text-ink-subtle italic">Sin coincidencias</li>
          ) : null}
        </ul>
      ) : null}

      {/* Panel de detalle de lo resaltado: totales combinados + abrir etiquetas. */}
      {seleccionadas.length > 0 && !open ? (
        <div className="mt-1.5 rounded-md border border-surface-border bg-white shadow-card divide-y divide-surface-border">
          {seleccionadas.map((p) => (
            <div key={p.nombre} className="px-2.5 py-1.5 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink truncate">{p.nombre}</span>
                {p.idProceso != null ? (
                  <button
                    type="button"
                    onClick={() => onOpenDetail(p.idProceso as number, p.nombre)}
                    className="shrink-0 text-status-pt hover:underline font-medium"
                  >
                    ver
                  </button>
                ) : null}
              </div>
              <div className="mt-0.5 flex items-center gap-2 tabular-nums text-ink-muted">
                <span className="text-status-covered">{fmtInt(p.disponibles)} disp.</span>
                <span>·</span>
                <span className="text-ink">{fmtInt(p.recibidas)} recib.</span>
                {p.inspeccion > 0 ? (
                  <>
                    <span>·</span>
                    <span className="text-status-partial">{fmtInt(p.inspeccion)} insp.</span>
                  </>
                ) : null}
                {p.nodos > 1 ? <span className="ml-auto text-ink-subtle">{p.nodos} nodos</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
