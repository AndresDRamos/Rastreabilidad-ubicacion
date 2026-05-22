export function EmptyState() {
  return (
    <div className="h-full w-full flex items-center justify-center text-center px-8">
      <div className="max-w-sm">
        <div className="mx-auto w-12 h-12 rounded-xl bg-status-pt/10 text-status-pt flex items-center justify-center mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-6 h-6"
          >
            <path d="M3 3h7v7H3z" />
            <path d="M14 3h7v7h-7z" />
            <path d="M14 14h7v7h-7z" />
            <path d="M3 14h7v7H3z" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-ink">
          Selecciona un PT de la lista
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Verás aquí su árbol BOM netteado con el inventario y los requerimientos por proceso.
        </p>
      </div>
    </div>
  );
}
