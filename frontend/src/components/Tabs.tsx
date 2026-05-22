import { usePts } from "@/api/queries";
import { dropCachedLayoutByPt } from "@/lib/layoutCache";
import { useUiStore } from "@/store/useUiStore";

export function Tabs() {
  const selectedPtIds = useUiStore((s) => s.selectedPtIds);
  const activeTabId = useUiStore((s) => s.activeTabId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const closeTab = useUiStore((s) => s.closeTab);
  const ventana = useUiStore((s) => s.ventana);
  const { data: filas } = usePts(ventana);

  if (selectedPtIds.length === 0) return null;

  const labelByIdPt = new Map<number, string>();
  if (filas) {
    for (const f of filas) {
      if (!labelByIdPt.has(f.idMaterial)) labelByIdPt.set(f.idMaterial, f.PT);
    }
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-surface-border bg-white overflow-x-auto">
      {selectedPtIds.map((idPt) => {
        const isActive = idPt === activeTabId;
        const label = labelByIdPt.get(idPt) ?? `#${idPt}`;
        return (
          <div
            key={idPt}
            className={`group inline-flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-md text-xs font-mono cursor-pointer transition shrink-0 ${
              isActive
                ? "bg-status-pt/10 text-status-pt border border-status-pt/30"
                : "text-ink-muted hover:bg-surface-subtle border border-transparent"
            }`}
            onClick={() => setActiveTab(idPt)}
            role="button"
            tabIndex={0}
          >
            <span>{label}</span>
            <button
              type="button"
              aria-label={`Cerrar ${label}`}
              onClick={(e) => {
                e.stopPropagation();
                dropCachedLayoutByPt(idPt);
                closeTab(idPt);
              }}
              className="opacity-60 group-hover:opacity-100 hover:bg-status-pt/20 rounded p-0.5 transition"
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
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
