import { useUiStore } from "@/store/useUiStore";
import type { Mode } from "@/api/types";

const OPCIONES: Array<{ value: Mode; label: string; hint: string }> = [
  { value: "requerimiento", label: "Requerimiento", hint: "piezas por fabricar" },
  { value: "inventario", label: "Inventario", hint: "piezas en piso" },
];

export function ModeToggle() {
  const mode = useUiStore((s) => s.mode);
  const setMode = useUiStore((s) => s.setMode);

  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-surface-subtle border border-surface-border">
      {OPCIONES.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => setMode(o.value)}
          title={o.hint}
          className={`px-3 py-1 text-xs font-medium rounded-md transition ${
            mode === o.value
              ? "bg-white text-ink shadow-soft"
              : "text-ink-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
