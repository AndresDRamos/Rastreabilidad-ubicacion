import { useEtiquetasDetalle } from "@/api/queries";
import { BUCKET_COLOR, BUCKET_LABEL } from "@/components/ui/BucketRow";
import { fmtInt } from "@/lib/format";
import { useUiStore } from "@/store/useUiStore";

// Mensaje de "sin resultados" especifico por bucket.
const BUCKET_EMPTY: Record<string, string> = {
  Encaminadas:
    "Ninguna etiqueta en el proceso origen tiene su ruta apuntando a este destino.",
};

export function EtiquetasDrawer() {
  const bloqueDetalle = useUiStore((s) => s.bloqueDetalle);
  const setBloqueDetalle = useUiStore((s) => s.setBloqueDetalle);
  const clienteIds = useUiStore((s) => s.filters.clienteIds);
  const ciudadIds = useUiStore((s) => s.filters.ciudadIds);
  const tipoMaterialIds = useUiStore((s) => s.filters.tipoMaterialIds);
  const claseIds = useUiStore((s) => s.filters.claseIds);
  const universo = useUiStore((s) => s.universo);

  const { data, isLoading, isFetching, error } = useEtiquetasDetalle(
    bloqueDetalle?.idProceso ?? null,
    bloqueDetalle?.bucket ?? null,
    clienteIds,
    bloqueDetalle?.idPlanta ?? null,
    ciudadIds,
    tipoMaterialIds,
    claseIds,
    universo,
    bloqueDetalle?.destino ?? null,
  );

  const isOpen = bloqueDetalle !== null;

  return (
    <>
      {/* Overlay */}
      <div
        aria-hidden="true"
        onClick={() => setBloqueDetalle(null)}
        className={`fixed inset-0 bg-ink/10 transition-opacity z-40 ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Drawer */}
      <aside
        aria-hidden={!isOpen}
        className={`fixed top-0 right-0 h-full w-full sm:w-[520px] bg-white shadow-card border-l border-surface-border z-50 transform transition-transform duration-200 flex flex-col ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {bloqueDetalle ? (
          <>
            <header className="px-5 py-4 border-b border-surface-border flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-ink-subtle">
                  Detalle de etiquetas
                </div>
                <h3 className="text-base font-semibold text-ink truncate">
                  {bloqueDetalle.tituloDestino
                    ? `${bloqueDetalle.nombreProceso} → ${bloqueDetalle.tituloDestino}`
                    : bloqueDetalle.nombreProceso}
                </h3>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span
                    className={`font-semibold ${
                      BUCKET_COLOR[bloqueDetalle.bucket] ?? "text-ink"
                    }`}
                  >
                    {BUCKET_LABEL[bloqueDetalle.bucket] ?? bloqueDetalle.bucket}
                  </span>
                  {data ? (
                    <span className="text-ink-subtle tabular-nums">
                      · {fmtInt(data.length)} etiquetas ·{" "}
                      {fmtInt(
                        data.reduce((acc, e) => acc + e.cantidad, 0),
                      )}{" "}
                      pzs
                    </span>
                  ) : null}
                  {isFetching && !isLoading ? (
                    <span className="text-ink-subtle">actualizando…</span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBloqueDetalle(null)}
                aria-label="Cerrar detalle"
                className="shrink-0 h-8 w-8 rounded hover:bg-surface-subtle flex items-center justify-center text-ink-muted hover:text-ink"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {isLoading ? (
                <DetalleSkeleton />
              ) : error ? (
                <div className="p-5 text-sm text-status-empty">
                  Error al cargar el detalle: {(error as Error).message}
                </div>
              ) : !data || data.length === 0 ? (
                <div className="p-5 text-sm text-ink-muted">
                  {BUCKET_EMPTY[bloqueDetalle.bucket] ??
                    "Sin etiquetas que coincidan con este bucket."}
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-muted/95 backdrop-blur-sm text-ink-muted">
                    <tr>
                      <Th>Etiqueta</Th>
                      <Th>Material</Th>
                      <Th>Último proc.</Th>
                      <Th>Siguiente</Th>
                      <Th>Ubicación</Th>
                      <Th className="text-right pr-5">Cantidad</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {data.map((e) => (
                      <tr
                        key={e.idEtiqueta}
                        className="hover:bg-surface-subtle"
                      >
                        <Td>
                          <span className="font-mono text-[11px] tabular-nums">
                            {e.idEtiqueta}
                          </span>
                        </Td>
                        <Td>
                          <div className="font-mono text-[11px] text-ink">
                            {e.ClaveMaterial}
                          </div>
                          {e.DescripcionMaterial ? (
                            <div
                              className="text-[10px] text-ink-subtle truncate max-w-[140px]"
                              title={e.DescripcionMaterial}
                            >
                              {e.DescripcionMaterial}
                            </div>
                          ) : null}
                        </Td>
                        <Td>{e.UltimoProceso ?? "—"}</Td>
                        <Td>{e.SiguienteProceso ?? "—"}</Td>
                        <Td>
                          {e.ubicacionNombre ?? e.UbicacionProceso ?? "—"}
                        </Td>
                        <Td className="text-right pr-5 tabular-nums font-medium text-ink">
                          {fmtInt(e.cantidad)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : null}
      </aside>
    </>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`text-left font-medium uppercase tracking-wide text-[10px] px-3 py-2 border-b border-surface-border ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 text-ink-muted align-top ${className}`}>
      {children}
    </td>
  );
}

function DetalleSkeleton() {
  return (
    <div className="p-3 space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-9 rounded bg-surface-subtle animate-pulse"
        />
      ))}
    </div>
  );
}
