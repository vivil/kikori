// Draws the images that appear when a link to the site is shared (1200 x 630).
// Needs Playwright, which is not a dependency of the site: `npm install --no-save playwright`.
// Run it again only when the headline, the logo or the benchmark numbers change.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = new URL("../", import.meta.url);
const font = (weight) => readFileSync(new URL(`src/fonts/line-seed-jp-${weight}.woff2`, root)).toString("base64");
const logo = readFileSync(new URL("public/kikori-logo-light.svg", root), "utf8").replace(/<\?xml[^>]*>/, "");

const CARDS = [
  { file: "og-en.png", lang: "en", title: "WCAG audits that go past what axe-core can check", sub: "An MCP server for coding agents" },
  { file: "og-ja.png", lang: "ja", title: "axe-core の先まで調べる WCAG 監査", sub: "コーディングエージェント向けの MCP サーバー" },
];
const RINGS = [
  { r: 158, value: 74.3, color: "#b5651d" },
  { r: 112, value: 59.1, color: "#4e6b2a" },
  { r: 66, value: 53.5, color: "#2f5d73" },
];

const browser = await chromium.launch();
for (const card of CARDS) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html lang="${card.lang}"><head><style>
    @font-face { font-family: "Seed"; font-weight: 400; src: url(data:font/woff2;base64,${font(400)}); }
    @font-face { font-family: "Seed"; font-weight: 800; src: url(data:font/woff2;base64,${font(800)}); }
    body { margin: 0; width: 1200px; height: 630px; background: #f7ebd6; color: #2e1b0c; font-family: "Seed", sans-serif; display: grid; grid-template-columns: 1fr 470px; align-items: center; }
    .copy { padding: 0 0 0 72px; }
    .logo svg { width: 250px; height: auto; display: block; }
    h1 { margin: 44px 0 0; font-weight: 800; font-size: ${card.lang === "ja" ? 62 : 58}px; line-height: 1.2; letter-spacing: -0.01em; word-break: auto-phrase; }
    p { margin: 26px 0 0; font-size: 28px; color: #553a23; }
    .stump { width: 420px; height: 420px; }
  </style></head><body>
    <div class="copy"><div class="logo">${logo}</div><h1>${card.title.replace("axe-core", '<span style="white-space:nowrap">axe-core</span>')}</h1><p>${card.sub}</p></div>
    <svg class="stump" viewBox="0 0 400 400">
      <circle cx="200" cy="200" r="194" fill="#4a2e17"/><circle cx="200" cy="200" r="183" fill="#fbf3e2"/>
      ${RINGS.map((ring) => `<circle cx="200" cy="200" r="${ring.r}" fill="none" stroke="#e7d6b6" stroke-width="26"/><circle cx="200" cy="200" r="${ring.r}" fill="none" stroke="${ring.color}" stroke-width="26" stroke-linecap="round" pathLength="100" stroke-dasharray="${ring.value} 100" transform="rotate(-90 200 200)"/>`).join("")}
      <circle cx="200" cy="200" r="9" fill="#4a2e17"/><path d="M304 38 L333 62 L236 174 Z" fill="#4a2e17"/>
    </svg>
  </body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL(`public/${card.file}`, root).pathname });
  await page.close();
  console.log(`wrote public/${card.file}`);
}
await browser.close();
