/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme-mode="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        ui: [
          "-apple-system",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Cascadia Code",
          "Consolas",
          "Liberation Mono",
          "Menlo",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
