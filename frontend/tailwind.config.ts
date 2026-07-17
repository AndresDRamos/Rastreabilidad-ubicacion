import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Paleta tipo Linear/Notion — neutros con acentos.
        surface: {
          DEFAULT: "#ffffff",
          muted: "#fafafa",
          subtle: "#f5f5f5",
          border: "#e5e5e5",
        },
        ink: {
          DEFAULT: "#0f172a",
          muted: "#475569",
          subtle: "#94a3b8",
        },
        // Estados del nodo
        status: {
          covered: "#10b981",   // verde — req_paso cubierto
          partial: "#f59e0b",   // naranja — parcialmente cubierto
          empty: "#ef4444",     // rojo — sin WIP
          pt: "#3b82f6",        // azul — PT raiz
          neutral: "#64748b",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.06)",
        soft: "0 1px 2px rgba(15,23,42,0.05)",
      },
      keyframes: {
        "popover-in": {
          "0%": { opacity: "0", transform: "scale(0.96) translateY(-4px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
      },
      animation: {
        // Panel flotante (ej. FiltersHeader): fade + scale/slide sutil al abrir.
        "popover-in": "popover-in 140ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
