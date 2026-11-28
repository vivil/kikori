// Writes the rendered page into the built HTML files, so that the content is there before any
// script runs. The browser then attaches the interactive parts to that HTML.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { build } from "vite";

const root = new URL("../", import.meta.url);
const out = new URL("dist-ssr/", root);

await build({
  logLevel: "warn",
  build: { ssr: "src/entry-server.tsx", outDir: "dist-ssr", emptyOutDir: true, rollupOptions: { input: "src/entry-server.tsx" } },
});
const { render } = await import(new URL("entry-server.js", out).href);

for (const [locale, file] of [["en", "dist/index.html"], ["ja", "dist/ja/index.html"]]) {
  const path = new URL(file, root);
  const html = readFileSync(path, "utf8");
  const marker = '<div id="root"></div>';
  if (!html.includes(marker)) throw new Error(`${file} has no ${marker}`);
  writeFileSync(path, html.replace(marker, `<div id="root">${render(locale)}</div>`));
  console.log(`prerendered ${file}`);
}
rmSync(out, { recursive: true, force: true });
