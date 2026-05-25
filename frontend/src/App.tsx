import { ArbolCanvas } from "./components/Canvas/ArbolCanvas";
import { ModeToggle } from "./components/ModeToggle";
import { Sidebar } from "./components/Sidebar/Sidebar";
import { SummaryView } from "./components/Summary/SummaryView";
import { Tabs } from "./components/Tabs";
import { useUiStore } from "./store/useUiStore";

function App() {
  const view = useUiStore((s) => s.view);
  const activeTabId = useUiStore((s) => s.activeTabId);

  return (
    <div className="h-full w-full flex bg-surface-muted text-ink">
      <Sidebar />
      <main className="flex-1 h-full overflow-hidden relative flex flex-col">
        <div className="shrink-0 bg-white">
          <Tabs />
          {view === "tree" ? (
            <div className="px-4 py-2 border-b border-surface-border flex items-center justify-between">
              <div className="text-xs text-ink-muted">
                Vista del arbol netteado
              </div>
              <ModeToggle />
            </div>
          ) : null}
        </div>
        <div className="flex-1 min-h-0">
          {view === "tree" && activeTabId !== null ? (
            <ArbolCanvas key={activeTabId} idPt={activeTabId} />
          ) : (
            <SummaryView />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
