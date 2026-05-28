import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dae6ff",
          200: "#bcd3ff",
          300: "#8db5ff",
          400: "#588dff",
          500: "#3367ff",
          600: "#1f48f5",
          700: "#1a37dd",
          800: "#1c31b2",
          900: "#1d318c",
        },
      },
      fontFamily: {
        sans: [
          "Heebo",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        soft: "0 10px 30px -10px rgba(15, 23, 42, 0.15)",
      },
    },
  },
  plugins: [],
};

export default config;
