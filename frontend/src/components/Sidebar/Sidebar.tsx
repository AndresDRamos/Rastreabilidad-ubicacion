import { useState } from "react";
import { CalendarioPanel } from "./CalendarioPanel";
import { FiltersHeader } from "./FiltersHeader";
import { PtTable } from "./PtTable";
import { UniversoSelect } from "./UniversoSelect";
import { useUiStore } from "@/store/useUiStore";

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
      <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 8h14M7 2.5v3M13 2.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4" aria-hidden="true">
      <path d="M6 5h11M6 10h11M6 15h11M3 5h.01M3 10h.01M3 15h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SidebarHeader({
  expanded,
  onToggleExpand,
  onCollapse,
}: {
  expanded: boolean;
  onToggleExpand: () => void;
  onCollapse: () => void;
}) {
  return (
    <header className="shrink-0 px-4 pt-4 pb-2 flex items-start justify-between gap-2">
      <h1 className="text-sm font-semibold text-ink">Rastreabilidad</h1>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-pressed={expanded}
          aria-label={expanded ? "Ver lista" : "Ver calendario de requerimiento"}
          title={expanded ? "Ver lista" : "Ver calendario de requerimiento"}
          className={`w-6 h-6 flex items-center justify-center rounded transition ${
            expanded
              ? "bg-status-pt/10 text-status-pt"
              : "text-ink-muted hover:bg-surface-muted hover:text-ink"
          }`}
        >
          {expanded ? <ListIcon /> : <CalendarIcon />}
        </button>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Colapsar sidebar"
          title="Colapsar sidebar"
          className="w-6 h-6 flex items-center justify-center rounded text-ink-muted hover:bg-surface-muted hover:text-ink"
        >
          {"<"}
        </button>
      </div>
    </header>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const expanded = useUiStore((s) => s.sidebarExpanded);
  const toggleExpanded = useUiStore((s) => s.toggleSidebarExpanded);

  // El panel calendario expandido flota SOBRE la vista Resumen (overlay), no
  // ocupa espacio en el layout: el aside base se queda en 360px. z alto para
  // pintar por encima de <main>.
  const overlay = expanded && !collapsed;

  return (
    <aside
      className={`relative shrink-0 h-full bg-surface border-r border-surface-border transition-[width] duration-300 ease-in-out ${
        collapsed ? "w-8" : "w-[360px]"
      } ${overlay ? "overflow-visible z-30" : "overflow-hidden"}`}
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

      {/* Contenido base (lista). Se mantiene montado; queda cubierto por el
          overlay cuando el panel se expande, para volver instantaneo. */}
      <div
        className={`w-[360px] h-full flex flex-col transition-opacity duration-200 ${
          collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
        }`}
        aria-hidden={collapsed}
      >
        <SidebarHeader
          expanded={false}
          onToggleExpand={toggleExpanded}
          onCollapse={() => setCollapsed(true)}
        />
        <UniversoSelect />
        <FiltersHeader />
        <PtTable />
      </div>

      {/* Overlay expandido: calendario de requerimiento por encima del Resumen. */}
      {overlay ? (
        <div className="absolute top-0 left-0 h-full w-[min(920px,92vw)] z-40 flex flex-col bg-surface border-r border-surface-border shadow-2xl animate-popover-in">
          <SidebarHeader
            expanded
            onToggleExpand={toggleExpanded}
            onCollapse={() => setCollapsed(true)}
          />
          <UniversoSelect />
          <FiltersHeader />
          <CalendarioPanel />
        </div>
      ) : null}
    </aside>
  );
}
