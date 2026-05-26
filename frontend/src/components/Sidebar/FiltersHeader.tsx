import { useUiStore } from "@/store/useUiStore";
import { CiudadMultiSelect } from "./CiudadMultiSelect";
import { ClaseMultiSelect } from "./ClaseMultiSelect";
import { ClienteCombobox } from "./ClienteCombobox";

export function FiltersHeader() {
  const filters = useUiStore((s) => s.filters);
  const setFilter = useUiStore((s) => s.setFilter);

  return (
    <div className="px-4 pt-4 pb-3 space-y-2 border-b border-surface-border">
      <ClienteCombobox />
      <CiudadMultiSelect />
      <ClaseMultiSelect />
      <Input
        placeholder="Numero de parte"
        value={filters.pt}
        onChange={(v) => setFilter("pt", v)}
      />
      <div>
        <label className="flex items-center justify-between text-xs text-ink-muted mb-1">
          <span>Fecha promesa hasta</span>
          {filters.fechaMax ? (
            <button
              type="button"
              onClick={() => setFilter("fechaMax", "")}
              className="text-status-pt hover:underline focus:outline-none"
            >
              limpiar
            </button>
          ) : null}
        </label>
        <input
          type="date"
          value={filters.fechaMax}
          onChange={(e) => setFilter("fechaMax", e.target.value)}
          className={`w-full h-9 px-3 text-sm rounded-md border border-surface-border bg-white focus:outline-none focus:ring-2 focus:ring-status-pt/30 focus:border-status-pt/50 transition ${
            filters.fechaMax ? "text-ink" : "text-ink-subtle"
          }`}
        />
      </div>
    </div>
  );
}

function Input({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-9 px-3 text-sm rounded-md border border-surface-border bg-white text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-status-pt/30 focus:border-status-pt/50 transition"
    />
  );
}
