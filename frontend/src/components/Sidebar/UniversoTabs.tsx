import type { Universo } from "@/api/types";
import { useUiStore } from "@/store/useUiStore";

const TABS: { value: Universo; label: string }[] = [
  { value: "general", label: "General" },
  { value: "caterpillar", label: "Caterpillar Priority" },
];

/** Segmented control que acota el universo de PTs (listado + bloques + flujo)
 *  a "General" (toda la demanda) o "Caterpillar Priority" (CSV de numeros
 *  criticos del lado backend). */
export function UniversoTabs() {
  const universo = useUiStore((s) => s.universo);
  const setUniverso = useUiStore((s) => s.setUniverso);

  return (
    <div
      role="tablist"
      aria-label="Universo de PTs"
      className="mx-4 mb-2 grid grid-cols-2 gap-1 p-1 rounded-lg bg-surface-muted border border-surface-border"
    >
      {TABS.map((t) => {
        const active = universo === t.value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setUniverso(t.value)}
            className={`text-xs font-medium px-2 py-1.5 rounded-md transition truncate ${
              active
                ? "bg-white text-status-pt shadow-soft border border-status-pt/30"
                : "text-ink-muted hover:text-ink hover:bg-white/60 border border-transparent"
            }`}
            title={t.label}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
