import { ArbolCanvas } from "./components/Canvas/ArbolCanvas";
import { EmptyState } from "./components/Canvas/EmptyState";
import { ModeToggle } from "./components/ModeToggle";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { Tabs } from "./components/Tabs";
import { useUiStore } from "./store/useUiStore";

function App() {
  const selectedPtIds = useUiStore((s) => s.selectedPtIds);
  const activeTabId = useUiStore((s) => s.activeTabId);
  // Cuando hay seleccion pero no hay activeTabId aun, usamos el primero.
  const idPt = activeTabId ?? selectedPtIds[0] ?? null;

  return (
    <div className="h-full w-full flex bg-surface-muted text-ink">
      <Sidebar />
      <main className="flex-1 h-full overflow-hidden relative flex flex-col">
        {idPt === null ? (
          <EmptyState />
        ) : (
          <>
            <div className="shrink-0 bg-white">
              <Tabs />
              <div className="px-4 py-2 border-b border-surface-border flex items-center justify-between">
                <div className="text-xs text-ink-muted">
                  Vista del arbol netteado
                </div>
                <ModeToggle />
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <ArbolCanvas key={idPt} idPt={idPt} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
