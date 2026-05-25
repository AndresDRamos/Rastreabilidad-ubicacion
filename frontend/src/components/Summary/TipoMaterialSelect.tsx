const TIPOS: ReadonlyArray<{ id: number; label: string }> = [
  { id: 1, label: "PT" },
  { id: 3, label: "Intermedio" },
];

export function TipoMaterialSelect({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const toggle = (id: number) => {
    if (value.includes(id)) {
      onChange(value.filter((x) => x !== id));
    } else {
      onChange([...value, id]);
    }
  };

  return (
    <div className="inline-flex items-center gap-2 text-xs text-ink-muted">
      <span>Tipo</span>
      <div className="inline-flex rounded-md border border-surface-border bg-white overflow-hidden">
        {TIPOS.map((t, i) => {
          const active = value.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              aria-pressed={active}
              className={`h-8 px-3 text-xs transition focus:outline-none focus:ring-2 focus:ring-status-pt/30 ${
                i > 0 ? "border-l border-surface-border" : ""
              } ${
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
