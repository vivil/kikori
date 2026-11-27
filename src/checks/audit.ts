import { tr } from "../i18n.js";
import { checkAxe } from "./axe.js";
import { checkKeyboardFocus } from "./focus.js";
import { checkInteraction } from "./interaction.js";
import { checkPresentation } from "./presentation.js";
import { checkReflow } from "./reflow.js";
import { checkTextSpacing } from "./textSpacing.js";
import { criteriaOf, inVersion, WCAG22_ADDED, withinLevel, type Level, type SuccessCriterion, type WcagVersion } from "../criteria.js";
import { ALWAYS_JUDGED } from "../evidence.js";
import { summarize, type CheckResult } from "../types.js";

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

export interface Judgment {
  /** 達成基準の番号 */
  id: string;
  /** unsure は、材料だけでは決められなかったことを表す。 */
  verdict: "pass" | "fail" | "inapplicable" | "unsure";
  /** 判断の根拠 */
  reason: string;
  /** fail の根拠にした箇所のセレクターか文言 */
  evidence?: string;
}

/**
 * 達成基準ごとの状態。
 * - fail: 自動検査で不適合が見つかった
 * - review: 自動では判定できず、人の確認が必要な箇所が見つかった
 * - no_issue_found: 自動検査の範囲では問題が見つからなかった (適合の保証ではない)
 * - needs_judgment: 判断材料は集められるが、内容を見て判断する必要がある (collect_evidence を使う)
 * - judged_pass: 呼び出し側の判断で、満たしているとされた
 * - inapplicable: 対象になる要素がページになく、該当しないと推定した (または、そう判断された)
 * - manual: 判断材料を集める手段もなく、人の確認が必要
 */
export type CriterionStatus = "fail" | "review" | "needs_judgment" | "no_issue_found" | "judged_pass" | "inapplicable" | "manual";

export interface CriterionRow {
  id: string;
  name: string;
  level: Level;
  status: CriterionStatus;
  fail: number;
  review: number;
  /** この達成基準を調べた検査の名前 */
  checkedBy: string[];
  note?: string;
  judgment?: Judgment;
}

/**
 * WCAG 2.1 の正誤表は、HTML で書かれたコンテンツについて 4.1.1 を常に満たすものとして扱うと定めている。
 * ブラウザが構文の誤りを一定の規則で解釈するようになり、支援技術が直接マークアップを解析しなくなったため。
 */
const ALWAYS_SATISFIED: Record<string, () => string> = {
  "4.1.1": () => tr("WCAG 2.1 の正誤表により、HTML のコンテンツでは常に満たすものとして扱います。", "Treated as always satisfied for HTML content, per the WCAG 2.1 errata."),
};

export interface CriteriaSummary {
  criteria: CriterionRow[];
  beyondTarget: CriterionRow[];
  counts: Record<CriterionStatus, number>;
  verdict: Verdict;
  explanation: string;
}

/**
 * - nonconformant: 不適合が見つかった
 * - undetermined: 不適合は見つからないが、確認が残っている
 * - no_failure_found: 自動検査と呼び出し側の判断を合わせて、すべての達成基準で不適合が見つからなかった
 */
export type Verdict = "nonconformant" | "undetermined" | "no_failure_found";

/** 目標のレベルを超える達成基準の指摘を取り除く。 */
export function limitToLevel(result: CheckResult, level: Level): CheckResult {
  // バージョンによる絞り込みは、達成基準の一覧を作るときに行う。2.1 を対象にしたときも、
  // 2.2 で追加された達成基準の指摘は beyondTarget に出すので、ここでは残しておく。
  const findings = result.findings.filter((f) => withinLevel(f.sc, level));
  return { ...result, findings, summary: summarize(findings) };
}

/** 検査結果の集まりを、達成基準ごとの状態にまとめる。複数ページの結果を混ぜて渡してもよい。 */
export function summarizeCriteria(results: CheckResult[], level: Level, judgments: Judgment[] = [], version: WcagVersion = "2.2"): CriteriaSummary {
  const judged = new Map(judgments.map((j) => [j.id, j]));
  const toRow = (sc: SuccessCriterion): CriterionRow => {
    let fail = 0;
    let review = 0;
    const checkedBy = new Set<string>();
    let inapplicable = false;
    for (const result of results) {
      const own = result.findings.filter((f) => f.sc.id === sc.id);
      fail += own.filter((f) => f.severity === "fail").length;
      review += own.filter((f) => f.severity === "review").length;
      if (result.checked.includes(sc.id) || own.length > 0) checkedBy.add(result.check);
      if (result.inapplicable?.includes(sc.id)) inapplicable = true;
    }
    const errata = ALWAYS_SATISFIED[sc.id]?.();
    if (errata) checkedBy.add("wcag21_errata");
    const wantsJudgment = !errata && (ALWAYS_JUDGED.includes(sc.id) || results.some((r) => r.needsJudgment?.includes(sc.id)));
    const untouched = checkedBy.size === 0;

    let status: CriterionStatus =
      fail > 0
        ? "fail"
        : review > 0
          ? "review"
          : inapplicable && (untouched || !wantsJudgment)
            ? untouched ? "inapplicable" : "no_issue_found"
            : wantsJudgment
              ? "needs_judgment"
              : untouched
                ? "manual"
                : "no_issue_found";

    let note = errata;
    const judgment = judged.get(sc.id);
    if (judgment) {
      if (fail > 0 && judgment.verdict !== "fail") {
        note = tr("自動検査で不適合が見つかっているため、渡された判断は反映していません。", "An automated check found a failure, so the supplied judgment was not applied.");
      } else if (judgment.verdict === "unsure") {
        if (fail === 0) status = "review";
        note = tr("モデルは、材料だけでは判断できないと答えました。人が確認してください。", "The model answered that the material was not enough to decide. A person needs to check.");
      } else if (judgment.verdict === "fail" && !judgment.evidence?.trim()) {
        if (fail === 0) status = "review";
        note = tr("不適合という判断に、根拠の箇所が示されていません。要確認として扱っています。", "The failing judgment does not point to the evidence it relies on, so it is treated as a review item.");
      } else {
        status = judgment.verdict === "fail" ? "fail" : judgment.verdict === "pass" ? "judged_pass" : "inapplicable";
      }
    }
    return {
      id: sc.id,
      name: sc.name,
      level: sc.level,
      status,
      fail,
      review,
      checkedBy: [...checkedBy],
      ...(note ? { note } : {}),
      ...(judgment ? { judgment } : {}),
    };
  };

  const criteria = criteriaOf(version).filter((sc) => withinLevel(sc, level)).map(toRow);
  // 2.1 を対象にしたときは、2.2 で追加された達成基準のうち検査したものを、参考として別に返す。
  const beyondTarget =
    version === "2.1"
      ? WCAG22_ADDED.filter((sc) => withinLevel(sc, level))
          .map(toRow)
          .filter((r) => r.status !== "manual")
      : [];
  const counts: Record<CriterionStatus, number> = { fail: 0, review: 0, needs_judgment: 0, no_issue_found: 0, judged_pass: 0, inapplicable: 0, manual: 0 };
  for (const row of criteria) counts[row.status]++;

  const open = counts.review + counts.needs_judgment + counts.manual;
  const verdict: Verdict = counts.fail > 0 ? "nonconformant" : open > 0 ? "undetermined" : "no_failure_found";
  const explanation =
    verdict === "nonconformant"
      ? tr(`${counts.fail} 件の達成基準で不適合が見つかりました。WCAG ${version} レベル ${level} には適合していません。`, `Failures were found in ${counts.fail} success criteria. The page does not conform to WCAG ${version} Level ${level}.`)
      : verdict === "undetermined"
        ? tr(`自動検査では不適合が見つかりませんでした。ただし ${open} 件の達成基準は確認が残っています (要確認 ${counts.review} 件、判断待ち ${counts.needs_judgment} 件、手動 ${counts.manual} 件)。判断待ちの達成基準は、collect_evidence で材料を集めて判断し、judgments に渡して再実行してください。`, `No failures were found by the automated checks, but ${open} success criteria are still open (needs review ${counts.review}, awaiting judgment ${counts.needs_judgment}, manual ${counts.manual}). For those awaiting judgment, gather material with collect_evidence, decide, and run again with the decisions in judgments.`)
        : tr(`自動検査と渡された判断を合わせて、WCAG ${version} レベル ${level} のすべての達成基準で不適合が見つかりませんでした。自動検査は調べられる範囲に限りがあり、判断はモデルによるものを含みます。適合を表明する前に、支援技術を使った人による確認を行ってください。`, `Combining the automated checks and the supplied judgments, no failures were found in any WCAG ${version} Level ${level} success criterion. Automated checks cover a limited range and some judgments were made by a model. Have a person verify with assistive technology before claiming conformance.`);
  return { criteria, beyondTarget, counts, verdict, explanation };
}

export interface AuditResult {
  url: string;
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
