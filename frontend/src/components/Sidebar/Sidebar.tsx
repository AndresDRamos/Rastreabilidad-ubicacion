import { useState } from "react";
import { FiltersHeader } from "./FiltersHeader";
import { PtTable } from "./PtTable";

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`relative shrink-0 h-full bg-surface border-r border-surface-border overflow-hidden transition-[width] duration-300 ease-in-out ${
        collapsed ? "w-8" : "w-[360px]"
      }`}
    >
      {/* Boton flotante para expandir cuando esta colapsado */}
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label="Expandir sidebar"
        title="Expandir sidebar"
        className={`absolute top-3 left-1/2 -translate-x-1/2 z-20 w-6 h-6 flex items-center justify-center rounded text-ink-muted hover:bg-surface-muted hover:text-ink transition-opacity duration-200 ${
          collapsed ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        {">"}
      </button>

      {/* Contenido completo: se mantiene montado para evitar re-render al expandir */}
      <div
        className={`w-[360px] h-full flex flex-col transition-opacity duration-200 ${
          collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
        aria-hidden={collapsed}
      >
        <header className="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
          <div>
            <h1 className="text-sm font-semibold text-ink">Rastreabilidad</h1>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Colapsar sidebar"
            title="Colapsar sidebar"
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-ink-muted hover:bg-surface-muted hover:text-ink"
          >
            {"<"}
          </button>
        </header>
        <FiltersHeader />
        <PtTable />
      </div>
    </aside>
  );
}
