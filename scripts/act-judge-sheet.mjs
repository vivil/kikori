// Prepares one ACT rule for blind judging by a model.
//
//   node scripts/act-judge-sheet.mjs <ruleId> <criterion> --out <dir> [--cache <dir>] [--sheet]
//
// For every test case of the rule it prints the evidence that kikori's collect_evidence returns, under
// a case number. The expected outcomes are written to a separate key file and are not printed. Page
// titles such as "Failed Example 1" give the answer away and are replaced. With --sheet it also
// writes one image that shows a screenshot of every case.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const args = process.argv.slice(2);
const [ruleId, criterion] = args;
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const cache = path.resolve(option("--cache", ".act-cache"));
const out = path.resolve(option("--out", ".act-judging"));

const dist = new URL("../dist/src/", import.meta.url);
const { configure, getSettings } = await import(new URL("config.js", dist).href);
const { collectEvidence, captureScreenshot } = await import(new URL("evidence.js", dist).href);
const { chromium } = await import("playwright");

const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".css": "text/css", ".js": "text/javascript", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".webm": "video/webm" };
const server = createServer((req, res) => {
  const file = path.join(cache, decodeURIComponent(new URL(req.url, "http://localhost").pathname));
  if (!file.startsWith(cache + path.sep) || !existsSync(file)) return res.writeHead(404).end();
  let body = readFileSync(file);
  if (file.endsWith(".html")) {
    body = Buffer.from(body.toString("utf8").replace(/<title>\s*(Passed|Failed|Inapplicable) Example[^<]*<\/title>/i, "<title>Example</title>"));
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
configure({ ...getSettings(), lang: "en", allowedHosts: ["127.0.0.1"], allowedFrameHosts: ["self"], storageState: null });

const index = JSON.parse(readFileSync(path.join(cache, "WAI/content-assets/wcag-act-rules/testcases.json"), "utf8"));
// Order by test case id, a hash that has nothing to do with the expected outcome.
const cases = index.testcases.filter((t) => t.ruleId === ruleId && /\.x?html$/.test(new URL(t.url).pathname)).sort((a, b) => a.testcaseId.localeCompare(b.testcaseId));

const key = {};
const shots = [];
const evidence = [];
for (const [i, testcase] of cases.entries()) {
  const number = i + 1;
  key[number] = { id: testcase.testcaseId, expected: testcase.expected, title: testcase.testcaseTitle };
  const url = base + new URL(testcase.url).pathname;
  const collected = await collectEvidence({ url, criteria: [criterion], screenshot: false });
  const item = collected.items[0];
  if (number === 1) console.log(`QUESTION: ${item.question}\nFAIL WHEN: ${item.failWhen}\n`);
  console.log(`Case ${number}: ${JSON.stringify(item.evidence)}`);
  evidence.push({ case: number, evidence: item.evidence });
  if (args.includes("--sheet")) shots.push((await captureScreenshot({ url, width: 480, height: 300 })).data);
}
server.close();

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, `${ruleId}-key.json`), `${JSON.stringify(key, null, 2)}\n`);
writeFileSync(path.join(out, `${ruleId}-evidence.json`), `${JSON.stringify(evidence, null, 2)}\n`);
if (shots.length > 0) {
  const cells = shots.map((data, i) => `<figure style="margin:0;border:2px solid #333"><figcaption style="font:bold 16px sans-serif;background:#333;color:#fff;padding:2px 6px">Case ${i + 1}</figcaption><img src="data:image/jpeg;base64,${data}" width="480"></figure>`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1480, height: 800 } });
  await page.setContent(`<body style="margin:8px;display:grid;grid-template-columns:repeat(3,484px);gap:8px">${cells.join("")}</body>`);
  await page.screenshot({ path: path.join(out, `${ruleId}-sheet.png`), fullPage: true });
  await browser.close();
}
