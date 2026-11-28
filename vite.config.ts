import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// The site is served from https://vivil.github.io/kikori/.
export default defineConfig({
  base: "/kikori/",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { en: resolve(import.meta.dirname, "index.html"), ja: resolve(import.meta.dirname, "ja/index.html") },
    },
  },
});
