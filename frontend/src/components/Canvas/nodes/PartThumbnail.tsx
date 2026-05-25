import React, { useState } from "react";

interface Props {
  clave: string;
  size?: number;
}

function PlaceholderIcon() {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full p-2 text-ink-subtle"
      aria-hidden="true"
    >
      <rect
        x="6" y="10" width="36" height="28"
        rx="3"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <circle cx="18" cy="21" r="4" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path
        d="M6 34 L16 24 L24 32 L32 22 L42 34"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

// El placeholder queda siempre presente como fondo para que el slot 64x64
// nunca colapse, ni durante el lazy-load ni cuando el servidor no tiene el JPG.
export const PartThumbnail = React.memo(function PartThumbnail({ clave, size = 64 }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const src = `http://192.168.4.5/Dibujos/normal/${clave}.jpg`;

  return (
    <div
      style={{ width: size, height: size }}
      className="relative shrink-0 rounded-md overflow-hidden bg-surface-subtle border border-surface-border flex items-center justify-center"
      role={errored ? "img" : undefined}
      aria-label={errored ? `Sin dibujo disponible para ${clave}` : undefined}
    >
      <PlaceholderIcon />

      {!errored && (
        <img
          src={src}
          alt={`Dibujo de la pieza ${clave}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
          className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-200 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
});
