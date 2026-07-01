import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,vue}", "./index.html"],
  theme: {
    extend: {
      colors: {
        sp: {
          bg:       "#07111f",
          bg2:      "#0b1728",
          surface:  "#101c2f",
          elevated: "#16243a",
          border:   "#26354d",
          muted:    "#94a3b8",
          text:     "#eef6ff",
          soft:     "#dbeafe",
          green:    "#22c55e",
          emerald:  "#10b981",
          red:      "#ef4444",
          amber:    "#f59e0b",
          blue:     "#38bdf8",
          indigo:   "#6366f1",
          violet:   "#8b5cf6",
        },
      },
      boxShadow: {
        soft: "0 24px 80px rgba(2, 8, 23, 0.42)",
        glow: "0 0 0 1px rgba(56,189,248,.18), 0 20px 80px rgba(56,189,248,.13)",
        success: "0 18px 50px rgba(34,197,94,.28)",
      },
      backgroundImage: {
        "soft-radial": "radial-gradient(circle at top left, rgba(56,189,248,.20), transparent 34%), radial-gradient(circle at 85% 18%, rgba(16,185,129,.16), transparent 28%), linear-gradient(135deg, #07111f 0%, #0b1728 44%, #111827 100%)",
        "card-sheen": "linear-gradient(145deg, rgba(255,255,255,.08), rgba(255,255,255,.025))",
      },
      animation: {
        ring: "ring 1.2s ease-in-out infinite",
        "fade-in": "fadeIn 0.22s ease-out",
        pulseSoft: "pulseSoft 1.8s ease-in-out infinite",
      },
      keyframes: {
        ring: {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%":      { transform: "scale(1.14)", opacity: "0.78" },
        },
        fadeIn: {
          "0%":   { opacity: "0", transform: "translateY(8px) translateX(-50%)" },
          "100%": { opacity: "1", transform: "translateY(0) translateX(-50%)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: ".65", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.06)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
