import { useUiStore } from "@/store/useUiStore";

import { FlujoPlantaSelect } from "./FlujoPlantaSelect";
import { TipoMaterialSelect } from "./TipoMaterialSelect";

/** Controles compartidos del overlay superior-izquierdo del Flujo: planta +
 *  tipo de material. El buscador de procesos se agrega aparte (solo en el
 *  drill-in, donde hay nodos de proceso). */
export function FlujoControls() {
  const tipoMaterialIds = useUiStore((s) => s.filters.tipoMaterialIds);
  const setFilter = useUiStore((s) => s.setFilter);

  return (
    <div className="w-64 flex flex-col gap-1.5">
      <FlujoPlantaSelect />
      <TipoMaterialSelect
        value={tipoMaterialIds}
        onChange={(v) => setFilter("tipoMaterialIds", v)}
        block
      />
    </div>
  );
}
