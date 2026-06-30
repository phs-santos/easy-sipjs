import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}", "./index.html"],
  theme: {
    extend: {
      colors: {
        sp: {
          bg:       "#0d1117",
          surface:  "#161b22",
          border:   "#30363d",
          muted:    "#8b949e",
          text:     "#e6edf3",
          green:    "#3fb950",
          red:      "#f85149",
          amber:    "#d29922",
          blue:     "#388bfd",
        },
      },
      animation: {
        ring:     "ring 1.2s ease-in-out infinite",
        "fade-in": "fadeIn 0.2s ease-out",
      },
      keyframes: {
        ring: {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%":      { transform: "scale(1.15)", opacity: "0.7" },
        },
        fadeIn: {
          "0%":   { opacity: "0", transform: "translateY(8px) translateX(-50%)" },
          "100%": { opacity: "1", transform: "translateY(0) translateX(-50%)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
