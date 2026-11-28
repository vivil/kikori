import { tr } from "../../packages/core/src/i18n.js";
import { checkAxe } from "./axe.js";
import { checkKeyboardFocus } from "./focus.js";
import { checkInteraction } from "./interaction.js";
import { checkPresentation } from "./presentation.js";
import { checkReflow } from "./reflow.js";
import { checkTextSpacing } from "./textSpacing.js";
import { type Level, type WcagVersion } from "../../packages/core/src/criteria.js";
import { ALWAYS_JUDGED } from "../evidence.js";
import { limitToLevel, summarizeCriteria as summarize, type CriteriaSummary, type CriterionRow, type CriterionStatus, type Judgment, type Verdict } from "../../packages/core/src/summary.js";
import { CORE_VERSION } from "../../packages/core/src/version.js";
import { type CheckResult } from "../../packages/core/src/types.js";

export { limitToLevel };
export type { CriteriaSummary, CriterionRow, CriterionStatus, Judgment, Verdict };

export interface AuditOptions {
  url: string;
  /** 目標とする適合レベル。既定値は AA。 */
  level?: Level;
  /** 対象とする WCAG のバージョン。既定値は 2.2。 */
  wcag?: WcagVersion;
  /** 呼び出し側のモデルや人が下した判断。達成基準の一覧に反映する。 */
  judgments?: Judgment[];
  waitForSelector?: string;
  waitMs?: number;
}

/**
 * WCAG 2.1 の正誤表は、HTML で書かれたコンテンツについて 4.1.1 を常に満たすものとして扱うと定めている。
 * ブラウザが構文の誤りを一定の規則で解釈するようになり、支援技術が直接マークアップを解析しなくなったため。
 */
const ALWAYS_SATISFIED: Record<string, () => string> = {
  "4.1.1": () => tr("WCAG 2.1 の正誤表により、HTML のコンテンツでは常に満たすものとして扱います。", "Treated as always satisfied for HTML content, per the WCAG 2.1 errata."),
};

/** 検査結果の集まりを、達成基準ごとの状態にまとめる。ウェブの検査に固有の決まりを、核の処理に渡す。 */
export function summarizeCriteria(results: CheckResult[], level: Level, judgments: Judgment[] = [], version: WcagVersion = "2.2"): CriteriaSummary {
  return summarize(results, level, judgments, version, { alwaysJudged: ALWAYS_JUDGED, alwaysSatisfied: ALWAYS_SATISFIED });
}

export interface AuditResult {
  url: string;
  /** 達成基準の一覧と状態のまとめ方を決めている、核のバージョン */
  coreVersion: string;
  target: string;
  conformance: {
    /** nonconformant: 不適合が見つかった / undetermined: 不適合は見つからないが、人の確認が残っている */
    verdict: Verdict;
    explanation: string;
    counts: Record<CriterionStatus, number>;
  };
  summary: { fail: number; review: number };
  criteria: CriterionRow[];
  /** wcag が 2.1 のとき、2.2 で追加された達成基準のうち検査したもの。判定には含めない。 */
  beyondTarget: CriterionRow[];
  results: CheckResult[];
}

/** すべての検査を順に実行し、達成基準ごとの状態にまとめる。 */
export async function auditPage(options: AuditOptions): Promise<AuditResult> {
  const level = options.level ?? "AA";
  const version = options.wcag ?? "2.2";
  const raw = [
    await checkAxe({ ...options, level, wcag: version }),
    await checkReflow(options),
    await checkTextSpacing(options),
    await checkKeyboardFocus(options),
    await checkPresentation(options),
    await checkInteraction(options),
  ];

  // 目標のレベルを超える達成基準の指摘は、判定にも一覧にも含めない。
  const results = raw.map((result) => limitToLevel(result, level));
  const { criteria, beyondTarget, counts, verdict, explanation } = summarizeCriteria(results, level, options.judgments, version);

  return {
    url: options.url,
    coreVersion: CORE_VERSION,
    target: tr(`WCAG ${version} レベル ${level}`, `WCAG ${version} Level ${level}`),
    conformance: { verdict, explanation, counts },
    summary: {
      fail: results.reduce((n, r) => n + r.summary.fail, 0),
      review: results.reduce((n, r) => n + r.summary.review, 0),
    },
    criteria,
    beyondTarget,
    results,
  };
}
