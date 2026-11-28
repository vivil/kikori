import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// The site is served from https://kikori.dev/. Asset paths are relative, so the same build also
// works under a sub-path such as https://vivil.github.io/kikori/, which redirects to the domain.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { en: resolve(import.meta.dirname, "index.html"), ja: resolve(import.meta.dirname, "ja/index.html") },
    },
  },
});
