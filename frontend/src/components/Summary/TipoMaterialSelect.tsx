const TIPOS: ReadonlyArray<{ id: number; label: string }> = [
  { id: 1, label: "Producto terminado" },
  { id: 3, label: "Intermedio" },
];

/**
 * Segmento PT / Intermedio. `block` = ocupa todo el ancho (overlay del Flujo);
 * por defecto es inline (cabecera de tarjetas).
 */
export function TipoMaterialSelect({
  value,
  onChange,
  block = false,
}: {
  value: number[];
  onChange: (next: number[]) => void;
  block?: boolean;
}) {
  const toggle = (id: number) => {
    if (value.includes(id)) {
      onChange(value.filter((x) => x !== id));
    } else {
      onChange([...value, id]);
    }
  };

  return (
    <div
      className={`items-center gap-2 text-xs text-ink-muted ${
        block ? "flex w-full" : "inline-flex"
      }`}
    >
      <span className="shrink-0">Tipo</span>
      <div
        className={`rounded-md border border-surface-border bg-white overflow-hidden shadow-soft ${
          block ? "flex flex-1" : "inline-flex"
        }`}
      >
        {TIPOS.map((t, i) => {
          const active = value.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              aria-pressed={active}
              className={`h-8 px-3 text-xs whitespace-nowrap transition focus:outline-none focus:ring-2 focus:ring-status-pt/30 ${
                block ? "flex-1" : ""
              } ${i > 0 ? "border-l border-surface-border" : ""} ${
                active
                  ? "bg-status-pt/10 text-status-pt font-medium"
                  : "text-ink-muted hover:bg-surface-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
