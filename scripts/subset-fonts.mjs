// Builds the two font files the site serves, holding only the characters the site uses.
//
// LINE Seed JP is about 3.6 MB per weight. The site needs a few hundred characters, so the
// subsets come to a few dozen kilobytes. Run this after changing any text: `npm run fonts`.
// `npm run build` runs it first, so a new character can never be left without a glyph.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import subsetFont from "subset-font";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

// Every file that holds text shown on the page.
const SOURCES = ["src/content.ts", "src/App.tsx", "index.html", "ja/index.html", "scripts/og-image.mjs"];
// Printable ASCII is always kept, so that code samples and numbers are covered.
const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
const characters = [...new Set([...ASCII, ...SOURCES.map(read).join("")])].filter((c) => c >= " ").sort().join("");

const WEIGHTS = [
  { weight: 400, file: "@expo-google-fonts/line-seed-jp/400Regular/LINESeedJP_400Regular.ttf" },
  { weight: 800, file: "@expo-google-fonts/line-seed-jp/800ExtraBold/LINESeedJP_800ExtraBold.ttf" },
];

mkdirSync(new URL("src/fonts/", root), { recursive: true });
for (const { weight, file } of WEIGHTS) {
  const source = readFileSync(require.resolve(file));
  const subset = await subsetFont(source, characters, { targetFormat: "woff2", noLayoutClosure: true });
  writeFileSync(new URL(`src/fonts/line-seed-jp-${weight}.woff2`, root), subset);
  console.log(`line-seed-jp-${weight}.woff2: ${characters.length} characters, ${(subset.length / 1024).toFixed(1)} kB (from ${(source.length / 1024 / 1024).toFixed(1)} MB)`);
}
