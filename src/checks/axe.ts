import { lang, tr } from "../i18n.js";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { withPage } from "../browser.js";
import { findCriterion, inVersion, withinLevel, type Level, type SuccessCriterion, type WcagVersion } from "../criteria.js";
import { summarize, type CheckResult, type Finding } from "../types.js";

export interface AxeOptions {
  url: string;
  /** 目標とする適合レベル。既定値は AA。 */
  level?: Level;
  /** 対象とする WCAG のバージョン。既定値は 2.2。 */
  wcag?: WcagVersion;
  width?: number;
  height?: number;
  waitForSelector?: string;
  waitMs?: number;
}

interface AxeNode {
  target: unknown[];
  failureSummary?: string;
  html: string;
}

interface AxeRuleResult {
  id: string;
  tags: string[];
  help: string;
  helpUrl: string;
  impact?: string | null;
  nodes: AxeNode[];
}

interface AxeResults {
  violations: AxeRuleResult[];
  incomplete: AxeRuleResult[];
  passes: AxeRuleResult[];
  inapplicable: AxeRuleResult[];
}

const TAGS: Record<Level, string[]> = {
  A: ["wcag2a", "wcag21a"],
  AA: ["wcag2a", "wcag21a", "wcag2aa", "wcag21aa"],
  AAA: ["wcag2a", "wcag21a", "wcag2aa", "wcag21aa", "wcag2aaa"],
};

/** 達成基準に対応しているが、既定では無効になっている試験的なルール */
const EXPERIMENTAL_RULES = ["css-orientation-lock", "p-as-heading", "table-fake-caption", "td-has-header"];

const MAX_NODES_PER_RULE = 10;

const require = createRequire(import.meta.url);

/** axe のタグ (wcag143 など) を達成基準に変換する。 */
export function criteriaFromTags(tags: string[]): SuccessCriterion[] {
  const found: SuccessCriterion[] = [];
  for (const tag of tags) {
    const match = /^wcag(\d)(\d)(\d+)$/.exec(tag);
    if (!match) continue;
    const sc = findCriterion(`${match[1]}.${match[2]}.${match[3]}`);
    if (sc) found.push(sc);
  }
  return found;
}

export async function checkAxe(options: AxeOptions): Promise<CheckResult> {
  const level = options.level ?? "AA";
  const version = options.wcag ?? "2.2";
  // WCAG 2.2 で追加されたルールは、レベル AA 以上を対象にしたときだけ加える。
  const tags = [...TAGS[level], ...(version === "2.2" && level !== "A" ? ["wcag22aa"] : [])];
  const inScope = (sc: SuccessCriterion): boolean => withinLevel(sc, level) && inVersion(sc, version);
  const viewport = { width: options.width ?? 1280, height: options.height ?? 720 };
  // axe の文面は英語が既定。日本語のときだけ、同梱の訳を読み込む。
  const locale = lang() === "ja" ? (JSON.parse(await readFile(require.resolve("axe-core/locales/ja.json"), "utf8")) as unknown) : null;

  return withPage({ ...options, viewport }, async (page) => {
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const results = (await page.evaluate(
      async ({ locale, tags, experimental }) => {
        // axe はページに読み込んだスクリプトが定義する。
        const axe = (window as unknown as { axe: { configure(o: unknown): void; run(c: unknown, o: unknown): Promise<unknown> } }).axe;
        if (locale) axe.configure({ locale });
        return axe.run(document, {
          runOnly: { type: "tag", values: tags },
          rules: Object.fromEntries(experimental.map((id) => [id, { enabled: true }])),
          resultTypes: ["violations", "incomplete"],
        });
      },
      { locale, tags, experimental: EXPERIMENTAL_RULES },
    )) as AxeResults;

    const findings: Finding[] = [];
    const notes: string[] = [];
    const push = (rule: AxeRuleResult, severity: "fail" | "review"): void => {
      // 1 つのルールが複数の達成基準にまたがる場合は、範囲内のものすべてに記録する。
      const criteria = criteriaFromTags(rule.tags).filter(inScope);
      if (criteria.length === 0) return;
      if (rule.nodes.length > MAX_NODES_PER_RULE) {
        notes.push(tr(`${rule.id} の指摘は ${rule.nodes.length} 件あり、先頭の ${MAX_NODES_PER_RULE} 件だけを報告しています。`, `${rule.id} has ${rule.nodes.length} findings; only the first ${MAX_NODES_PER_RULE} are reported.`));
      }
      for (const node of rule.nodes.slice(0, MAX_NODES_PER_RULE)) {
        for (const sc of criteria) {
          findings.push({
            sc,
            severity,
            selector: node.target.map((t) => (Array.isArray(t) ? t.join(" >>> ") : String(t))).join(" > "),
            message: severity === "fail" ? rule.help : tr(`${rule.help} (自動では判定できなかったため、確認が必要です)`, `${rule.help} (axe could not decide automatically; needs review)`),
            details: {
              rule: rule.id,
              impact: rule.impact ?? null,
              helpUrl: rule.helpUrl,
              html: node.html.slice(0, 200),
              ...(node.failureSummary ? { summary: node.failureSummary } : {}),
            },
          });
        }
      }
    };
    for (const rule of results.violations) push(rule, "fail");
    for (const rule of results.incomplete) push(rule, "review");

    const ids = (rules: AxeRuleResult[]): Set<string> =>
      new Set(rules.flatMap((r) => criteriaFromTags(r.tags)).filter(inScope).map((sc) => sc.id));
    const checked = ids([...results.passes, ...results.violations, ...results.incomplete]);
    const inapplicable = [...ids(results.inapplicable)].filter((id) => !checked.has(id));

    return {
      check: "axe",
      url: options.url,
      viewport,
      summary: summarize(findings),
      findings,
      checked: [...checked].sort(),
      inapplicable: inapplicable.sort(),
      data: { level, wcag: version, rulesRun: results.passes.length + results.violations.length + results.incomplete.length + results.inapplicable.length },
      ...(notes.length > 0 ? { notes } : {}),
    };
  });
}
