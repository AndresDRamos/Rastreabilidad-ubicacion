import { useListados } from "@/api/queries";
import { UNIVERSO_GENERAL } from "@/api/types";
import { useUiStore } from "@/store/useUiStore";

/**
 * Selector del universo de PTs: acota listado + bloques + flujo + calendario a
 * los numeros criticos de un cliente.
 *
 * Las opciones salen de GET /api/listados (manifiesto `listados/listados.json`
 * del lado backend), asi que dar de alta un cliente nuevo no toca este archivo.
 * "General" se antepone a mano: no es un listado, es la ausencia de filtro.
 *
 * Reemplaza al `UniversoTabs` de dos pestanas fijas que vivio aqui hasta
 * jul-2026: un segmented control deja de servir en cuanto hay mas de dos
 * clientes, y el sidebar no tiene ancho para repartir.
 */
export function UniversoSelect() {
  const universo = useUiStore((s) => s.universo);
  const setUniverso = useUiStore((s) => s.setUniverso);
  const { data: listados, isError } = useListados();

  // Sin listados dados de alta el selector no aporta nada: solo tendria
  // "General". Se oculta en vez de mostrar un control de una sola opcion.
  if (isError || !listados || listados.length === 0) return null;

  const activo = listados.find((l) => l.slug === universo);

  return (
    <div className="mx-4 mb-2">
      <label htmlFor="universo-select" className="sr-only">
        Universo de PTs
      </label>
      <select
        id="universo-select"
        value={universo}
        onChange={(e) => setUniverso(e.target.value)}
        className={`w-full h-9 px-3 text-sm rounded-md border bg-white transition focus:outline-none focus:ring-2 focus:ring-status-pt/30 focus:border-status-pt/50 ${
          universo === UNIVERSO_GENERAL
            ? "border-surface-border text-ink-subtle"
            : "border-status-pt/40 text-ink font-medium"
        }`}
        title={activo?.descripcion ?? "Todo el universo de demanda activa"}
      >
        <option value={UNIVERSO_GENERAL}>General — toda la demanda</option>
        {listados.map((l) => (
          <option key={l.slug} value={l.slug}>
            {l.nombre} — {l.n_materiales} n° de parte
          </option>
        ))}
      </select>

      {/* Un listado en cero filtra a nada y la vista queda vacia: sin este
          aviso parece que el piso no tiene trabajo, no que falta el archivo. */}
      {activo && activo.n_materiales === 0 ? (
        <p className="mt-1 text-xs text-status-empty">
          El listado «{activo.nombre}» no tiene números de parte cargados.
        </p>
      ) : null}
    </div>
  );
}
