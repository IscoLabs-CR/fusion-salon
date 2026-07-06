import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        paper: "#ffffff",
        ink: "#0b1210",
        muted: "#5c6b68",
        line: "#e6ece9",
        // Turquesa del logo — tono profundo para buen contraste sobre blanco.
        brand: {
          DEFAULT: "#0f766e",
          deep: "#115e59",
          tint: "#d7f2ec",
        },
        // Dorado del logo — para acentos decorativos (melcocha, bordes, detalles).
        gold: {
          DEFAULT: "#c19a4b",
          deep: "#8a6a24",
        },
      },
      fontFamily: {
        display: ["var(--font-oswald)", "sans-serif"],
        fancy: ["var(--font-fancy)", "Georgia", "serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono-ticket)", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
