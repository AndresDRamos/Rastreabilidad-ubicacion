import { usePlantas } from "@/api/queries";
import { useUiStore } from "@/store/useUiStore";

/** Selector de planta del modo Flujo: cambia el drill-in a la planta elegida
 *  (o "Todas" = vuelve al overview de plantas). Reemplaza a la miga de pan. */
export function FlujoPlantaSelect() {
  const { data: plantas } = usePlantas();
  const drill = useUiStore((s) => s.flujoPlantaDrill);
  const setDrill = useUiStore((s) => s.setFlujoPlantaDrill);

  return (
    <div className="relative w-full">
      <select
        value={drill?.idPlanta ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") {
            setDrill(null);
            return;
          }
          const id = Number(v);
          const p = plantas?.find((x) => x.idPlanta === id);
          setDrill({ idPlanta: id, nombre: p?.NombrePlanta ?? String(id) });
        }}
        className="w-full h-8 pl-3 pr-8 text-xs font-medium rounded-md border border-surface-border bg-white text-ink shadow-soft appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-status-pt/30 focus:border-status-pt/50 transition"
        aria-label="Planta del flujo"
      >
        <option value="">Todas las plantas (general)</option>
        {plantas?.map((p) => (
          <option key={p.idPlanta} value={p.idPlanta}>
            {p.NombrePlanta}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-subtle"
        aria-hidden="true"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}
