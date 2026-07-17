import { useState } from "react";

import { apiClient } from "@/api/client";
import { usePts } from "@/api/queries";
import { dropCachedLayoutByPt } from "@/lib/layoutCache";
import { useUiStore } from "@/store/useUiStore";

export function Tabs() {
  const view = useUiStore((s) => s.view);
  const selectedPtIds = useUiStore((s) => s.selectedPtIds);
  const activeTabId = useUiStore((s) => s.activeTabId);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const showSummary = useUiStore((s) => s.showSummary);
  const closeTab = useUiStore((s) => s.closeTab);
  const ventana = useUiStore((s) => s.ventana);
  const fechaMax = useUiStore((s) => s.filters.fechaMax);
  const universo = useUiStore((s) => s.universo);
  const { data: filas } = usePts(ventana, "", universo);

  const labelByIdPt = new Map<number, string>();
  if (filas) {
    for (const f of filas) {
      if (!labelByIdPt.has(f.idMaterial)) labelByIdPt.set(f.idMaterial, f.PT);
    }
  }

  const summaryActive = view === "summary";

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-surface-border bg-white overflow-x-auto">
      <button
        type="button"
        onClick={showSummary}
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium cursor-pointer transition shrink-0 ${
          summaryActive
            ? "bg-status-pt/10 text-status-pt border border-status-pt/30"
            : "text-ink-muted hover:bg-surface-subtle border border-transparent"
        }`}
        role="button"
        tabIndex={0}
        aria-pressed={summaryActive}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3.5 h-3.5"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="9" rx="1" />
          <rect x="14" y="3" width="7" height="5" rx="1" />
          <rect x="14" y="12" width="7" height="9" rx="1" />
          <rect x="3" y="16" width="7" height="5" rx="1" />
        </svg>
        <span>Resumen</span>
      </button>
      {selectedPtIds.map((idPt) => {
        const isActive = !summaryActive && idPt === activeTabId;
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
      {selectedPtIds.length > 0 ? (
        <ExportButton idsPt={selectedPtIds} ventana={ventana} fechaMax={fechaMax} />
      ) : null}
    </div>
  );
}

/** Descarga el .xlsx de TODOS los arboles abiertos (una hoja por PT).
 *
 *  El backend arma el archivo reusando el mismo netteo del arbol, asi que la
 *  ventana y la fecha del sidebar viajan con la peticion: el Excel refleja lo
 *  que el usuario esta viendo en pantalla.
 */
function ExportButton({
  idsPt,
  ventana,
  fechaMax,
}: {
  idsPt: number[];
  ventana: number;
  fechaMax: string;
}) {
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportar = async () => {
    setDescargando(true);
    setError(null);
    try {
      const params: Record<string, string | number> = {
        ids: idsPt.join(","),
        ventana,
      };
      if (fechaMax) params.fecha_max = fechaMax;
      const res = await apiClient.get("/export/arboles", {
        params,
        responseType: "blob",
      });

      // El nombre lo decide el backend (Content-Disposition, RFC 5987).
      const disp = String(res.headers["content-disposition"] ?? "");
      const m = /filename\*=UTF-8''([^;]+)/i.exec(disp);
      const nombre = m ? decodeURIComponent(m[1]) : "arboles.xlsx";

      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const omitidos = res.headers["x-export-omitidos"];
      if (omitidos) setError(`Sin datos para ${String(omitidos).split(",").length} PT(s)`);
    } catch {
      setError("No se pudo exportar");
    } finally {
      setDescargando(false);
    }
  };

  const n = idsPt.length;
  return (
    <div className="ml-auto flex items-center gap-2 shrink-0 pl-2">
      {error ? (
        <span className="text-[10px] text-status-empty" role="status">
          {error}
        </span>
      ) : null}
      <button
        type="button"
        onClick={exportar}
        disabled={descargando}
        title={`Exportar a Excel ${n === 1 ? "el árbol abierto" : `los ${n} árboles abiertos`} — una hoja por PT`}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition ${
          descargando
            ? "text-ink-subtle border-surface-border cursor-default"
            : "text-status-covered border-status-covered/30 hover:bg-status-covered/10 cursor-pointer"
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-3.5 h-3.5 ${descargando ? "animate-pulse" : ""}`}
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>{descargando ? "Generando..." : `Excel${n > 1 ? ` (${n})` : ""}`}</span>
      </button>
    </div>
  );
}
