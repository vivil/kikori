// Compares axe-core on its own with kikori against the W3C ACT Rules test cases.
//
//   npm run benchmark:act -- [--cache <dir>] [--out <dir>] [--rule <id>] [--jobs <n>] [--verbose]
//   node scripts/act-benchmark.mjs --report-only     rewrite the Markdown page from the existing JSON
//
// The test cases are downloaded from www.w3.org with curl and kept in the cache directory. They are
// served from a local HTTP server under their original paths, so the checks run against localhost.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const ORIGIN = "https://www.w3.org";
const INDEX = "/WAI/content-assets/wcag-act-rules/testcases.json";

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const cache = path.resolve(option("--cache", ".act-cache"));
const out = path.resolve(option("--out", "docs"));
const onlyRule = option("--rule", null);
const jobs = Number(option("--jobs", "4"));

if (args.includes("--report-only")) {
  const existing = JSON.parse(readFileSync(path.join(out, "act-results.json"), "utf8"));
  writeFileSync(path.join(out, "act-results.md"), report(existing));
  process.exit(0);
}

const dist = new URL("../dist/src/", import.meta.url);
const load = (file) => import(new URL(file, dist).href);
const { configure, getSettings } = await load("config.js");
const { checkAxe } = await load("checks/axe.js");
const { checkReflow } = await load("checks/reflow.js");
const { checkKeyboardFocus } = await load("checks/focus.js");
const { checkPresentation } = await load("checks/presentation.js");
const { checkInteraction } = await load("checks/interaction.js");
const { packageVersion } = await load("install.js");
const { chromium } = await import("playwright");
const axe = require("axe-core");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

// axe-core declares which ACT rule each of its rules implements.
const axeRulesFor = new Map();
for (const rule of axe.getRules()) {
  for (const id of rule.actIds ?? []) axeRulesFor.set(id, [...(axeRulesFor.get(id) ?? []), rule.ruleId]);
}

// kikori's own checks that test the same thing as an ACT rule: the check to run, and the success
// criterion under which it reports. Checks that share a criterion with a rule but look at something
// else are deliberately left out.
const OWN = {
  "59br37": { run: checkReflow, criterion: "1.4.4" }, // Zoomed text node is not clipped with CSS overflow
  "80af7b": { run: checkKeyboardFocus, criterion: "2.1.2" }, // Focusable element has no keyboard trap
  oj04fd: { run: checkKeyboardFocus, criterion: "2.4.7" }, // Element in sequential focus order has visible focus
  "80f0bf": { run: checkPresentation, criterion: "1.4.2" }, // Audio or video element avoids automatically playing audio
  ffbc54: { run: checkInteraction, criterion: "2.1.4" }, // No keyboard shortcut uses only printable characters
  "7677a9": { run: checkInteraction, criterion: "2.5.4" }, // Device motion based changes can also be created from the UI
  c249d5: { run: checkInteraction, criterion: "2.5.4" }, // Device motion based changes can be disabled
};

/** Downloads a path from www.w3.org into the cache unless it is already there. */
async function fetchCached(urlPath) {
  const file = path.join(cache, urlPath);
  if (!file.startsWith(cache + path.sep)) throw new Error(`Refusing to leave the cache directory: ${urlPath}`);
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    await run("curl", ["-sS", "-f", "--retry", "2", "-o", file, ORIGIN + urlPath]);
  }
  return file;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".xhtml": "application/xhtml+xml", ".svg": "image/svg+xml", ".xml": "application/xml", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".webm": "video/webm", ".vtt": "text/vtt", ".wav": "audio/wav", ".ogg": "audio/ogg" };

/** The success criteria a rule tests for conformance. Secondary requirements are left out. */
function criteriaOf(requirements) {
  const found = new Set();
  for (const [key, value] of Object.entries(requirements ?? {})) {
    const match = /^wcag2\d:(\d+\.\d+\.\d+)$/.exec(key);
    if (match && !value.secondary && value.forConformance !== false) found.add(match[1]);
  }
  return [...found].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

const index = JSON.parse(readFileSync(await fetchCached(INDEX), "utf8"));
const cases = index.testcases.filter((t) => !onlyRule || t.ruleId === onlyRule);

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = await fetchCached(urlPath);
    res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" }).end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

// A few test cases redirect to these hosts at once. Allow them so that the destination can be checked.
configure({ ...getSettings(), lang: "en", allowedHosts: ["127.0.0.1", "w3.org", "www.w3.org", "github.com"], allowedFrameHosts: ["self"], storageState: null });

const verdict = (failed, review) => (failed ? "failed" : review ? "cantTell" : "passed");

/** axe-core as shipped, with its default rules, run directly in a page. */
const browser = await chromium.launch();
async function axeAlone(url, ruleId) {
  const wanted = axeRulesFor.get(ruleId) ?? [];
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations", "incomplete"] }));
    const hit = (list) => list.some((r) => wanted.includes(r.id));
    return verdict(hit(result.violations), hit(result.incomplete));
  } finally {
    await page.close();
  }
}

/** kikori: its axe-core run plus its own check where one covers the rule. */
async function kikori(url, ruleId, testcase) {
  const wanted = axeRulesFor.get(ruleId) ?? [];
  const own = OWN[ruleId];
  const findings = (await checkAxe({ url, level: "AAA", wcag: "2.2" })).findings.filter((f) => wanted.includes(f.details?.rule));
  if (own) findings.push(...(await own.run({ url })).findings.filter((f) => f.sc.id === own.criterion));
  const outcome = verdict(findings.some((f) => f.severity === "fail"), findings.some((f) => f.severity === "review"));
  if (args.includes("--verbose") && (outcome === "failed") !== (testcase.expected === "failed")) {
    console.error(`${ruleId} ${testcase.testcaseTitle}: expected ${testcase.expected}, kikori ${outcome}`);
    for (const f of findings) console.error(`    ${f.severity} ${f.sc.id} ${f.details?.rule ?? ""} ${f.selector} :: ${f.message.slice(0, 90)}`);
  }
  return outcome;
}

const attempt = async (fn) => {
  try {
    return { outcome: await fn() };
  } catch (cause) {
    return { outcome: "error", error: String(cause?.message ?? cause).split("\n")[0] };
  }
};

const rules = new Map();
const skipped = { noCriterion: 0, notHtml: 0 };
const queue = [];
for (const testcase of cases) {
  const criteria = criteriaOf(testcase.ruleAccessibilityRequirements);
  if (criteria.length === 0) {
    skipped.noCriterion++;
    continue;
  }
  if (!/\.x?html$/.test(new URL(testcase.url).pathname)) {
    skipped.notHtml++;
    continue;
  }
  if (!rules.has(testcase.ruleId)) {
    rules.set(testcase.ruleId, {
      id: testcase.ruleId,
      name: testcase.ruleName,
      criteria,
      coveredByAxe: axeRulesFor.has(testcase.ruleId),
      coveredByKikori: axeRulesFor.has(testcase.ruleId) || testcase.ruleId in OWN,
      cases: [],
    });
  }
  queue.push(testcase);
}

let done = 0;
async function worker() {
  for (let testcase = queue.shift(); testcase; testcase = queue.shift()) {
    const url = base + new URL(testcase.url).pathname;
    const rule = rules.get(testcase.ruleId);
    // A tool that has nothing for a rule reports nothing for its test cases.
    const a = rule.coveredByAxe ? await attempt(() => axeAlone(url, rule.id)) : { outcome: "passed" };
    const k = rule.coveredByKikori ? await attempt(() => kikori(url, rule.id, testcase)) : { outcome: "passed" };
    rule.cases.push({ id: testcase.testcaseId, title: testcase.testcaseTitle, expected: testcase.expected, axe: a.outcome, kikori: k.outcome, ...(a.error ? { axeError: a.error } : {}), ...(k.error ? { kikoriError: k.error } : {}) });
    if (++done % 50 === 0) console.error(`${done} / ${done + queue.length}`);
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
await browser.close();
server.close();

/**
 * found: the rule expects "failed" and the tool reports a failure.
 * flagged: the rule expects "failed" and the tool only asks for review.
 * missed: the rule expects "failed" and the tool reports nothing.
 * falseAlarm: the rule expects "passed" or "inapplicable" and the tool reports a failure.
 */
function tally(list, tool) {
  const t = { expectedFailures: 0, found: 0, flagged: 0, missed: 0, falseAlarm: 0, error: 0 };
  for (const c of list) {
    const outcome = c[tool];
    if (outcome === "error") t.error++;
    if (c.expected === "failed") {
      t.expectedFailures++;
      if (outcome === "failed") t.found++;
      else if (outcome === "cantTell") t.flagged++;
      else t.missed++;
    } else if (outcome === "failed") t.falseAlarm++;
  }
  const ratio = (a, b) => (b === 0 ? null : a / b);
  return { ...t, precision: ratio(t.found, t.found + t.falseAlarm), recall: ratio(t.found, t.expectedFailures), surfaced: ratio(t.found + t.flagged, t.expectedFailures) };
}

const perRule = [...rules.values()]
  .map((rule) => ({ ...rule, axe: tally(rule.cases, "axe"), kikori: tally(rule.cases, "kikori") }))
  .sort((a, b) => a.criteria[0].localeCompare(b.criteria[0], undefined, { numeric: true }) || a.id.localeCompare(b.id));
const all = perRule.flatMap((r) => r.cases);
const summary = {
  generated: new Date().toISOString().slice(0, 10),
  kikori: packageVersion(),
  axeCore: axe.version,
  source: ORIGIN + INDEX,
  testcasesInSource: index.testcases.length,
  testcases: all.length,
  skipped,
  overall: { axe: tally(all, "axe"), kikori: tally(all, "kikori") },
  rules: perRule,
};

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "act-results.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(path.join(out, "act-results.md"), report(summary));
console.log(JSON.stringify({ testcases: all.length, rules: perRule.length, skipped, ...summary.overall }, null, 2));

/** The Markdown page that presents the results. */
function report(data) {
  const pct = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
  const a = data.overall.axe;
  const k = data.overall.kikori;
  const covered = (key) => data.rules.filter((r) => r[key]).length;
  const rows = data.rules.map((r) => {
    const cell = (t, has) => (has ? `${t.found} / ${t.flagged} / ${t.falseAlarm}` : "-");
    return `| [${r.name.replaceAll("|", "/")}](https://www.w3.org/WAI/standards-guidelines/act/rules/${r.id}/) | ${r.criteria.join(", ")} | ${r.axe.expectedFailures} | ${cell(r.axe, r.coveredByAxe)} | ${cell(r.kikori, r.coveredByKikori)} |`;
  });
  return `# ACT Rules benchmark

How axe-core on its own and kikori compare with the expected outcomes of the [W3C ACT Rules test cases](https://www.w3.org/WAI/standards-guidelines/act/rules/).

- Generated: ${data.generated}, with kikori ${data.kikori} and axe-core ${data.axeCore}
- Source: ${data.source} (${data.testcasesInSource} test cases)
- Reproduce: \`npm run benchmark:act\`. The raw numbers are in [act-results.json](act-results.json).

## Result

${data.testcases} test cases from ${data.rules.length} rules, of which ${a.expectedFailures} are expected to fail.

| | axe-core alone | kikori |
|---|---|---|
| Rules with a matching check | ${covered("coveredByAxe")} | ${covered("coveredByKikori")} |
| Expected failures reported as failures | ${a.found} | ${k.found} |
| Expected failures only flagged for review | ${a.flagged} | ${k.flagged} |
| Expected failures missed | ${a.missed} | ${k.missed} |
| False alarms | ${a.falseAlarm} | ${k.falseAlarm} |
| Precision | ${pct(a.precision)} | ${pct(k.precision)} |
| Recall | ${pct(a.recall)} | ${pct(k.recall)} |
| Recall counting review flags | ${pct(a.surfaced)} | ${pct(k.surfaced)} |
| Test cases that could not be run | ${a.error} | ${k.error} |

The rules that neither tool covers mostly need a judgment about meaning, such as whether a text alternative, a link text or a heading is descriptive, or whether a video has captions. kikori leaves those to \`collect_evidence\` and the calling model, which this benchmark does not exercise.

## Method and limits

- Only rules that map to a WCAG success criterion for conformance are evaluated. ${data.skipped.noCriterion} test cases belong to rules without one, and ${data.skipped.notHtml} are not HTML pages; both groups are skipped.
- Results are matched by rule. A finding counts for a rule only when it comes from a check that implements that rule: for axe-core, the rules that list the ACT rule in their own metadata; for kikori's own checks, the mapping in \`scripts/act-benchmark.mjs\`.
- "axe-core alone" is axe-core as shipped, with its default rules. kikori runs axe-core with a few experimental rules enabled and adds its own checks.
- A tool with no check for a rule reports nothing for that rule's test cases, which counts as missing every expected failure.
- Precision is the share of reported failures that were expected. Recall is the share of expected failures that were reported as failures.
- The pages are served from a local HTTP server rather than over HTTPS from www.w3.org.
- This is not a formal ACT implementation report and must not be presented as one.
- The ACT rules mostly cover what can be checked from a page's markup. Checks that kikori performs by operating the page, such as reflow, text spacing after an override, hover content or comparisons between pages, have few or no ACT rules and are barely measured here.

## Per rule

Each cell gives failures found / flagged for review / false alarms. A dash means the tool has no check for the rule.

| Rule | Success criteria | Expected failures | axe-core alone | kikori |
|---|---|---|---|---|
${rows.join("\n")}
`;
}
