import assert from "node:assert/strict";
import { test } from "node:test";
import { auditPage } from "../src/checks/audit.js";
import { checkInteraction } from "../src/checks/interaction.js";
import { captureScreenshot, collectEvidence } from "../src/evidence.js";
import type { CheckResult, Severity } from "../packages/core/src/types.js";

const fixture = (name: string): string => new URL(`../../test/fixtures/${name}`, import.meta.url).href;
const has = (result: CheckResult, sc: string, severity: Severity, selector: string): boolean =>
  result.findings.some((f) => f.sc.id === sc && f.severity === severity && f.selector === selector);

test("操作: ホバーで現れる内容のうち、ポインタを載せられないものだけを不適合にする", async () => {
  const result = await checkInteraction({ url: fixture("interaction-bad.html") });
  assert.ok(has(result, "1.4.13", "fail", "#fragile"));
  assert.ok(!result.findings.some((f) => f.sc.id === "1.4.13" && f.severity === "fail" && f.selector === "#sturdy"));
  assert.equal(result.data?.hoverContentFound, 2);
});

test("操作: 文字キーのショートカットと、値を変えただけで移動する欄を報告する", async () => {
  const result = await checkInteraction({ url: fixture("interaction-bad.html") });
  const keys = result.findings.find((f) => f.sc.id === "2.1.4");
  assert.deepEqual(keys?.details?.keys, ["s"]);
  assert.ok(has(result, "3.2.2", "fail", "#sort"));
  assert.ok(!result.findings.some((f) => f.selector === "#quiet"));
});

test("操作: イベントリスナー、境界のコントラスト、ステータスの領域を報告する", async () => {
  const result = await checkInteraction({ url: fixture("interaction-bad.html") });
  assert.ok(has(result, "2.5.1", "review", "#drag-area"));
  assert.ok(has(result, "2.5.2", "review", "#drag-area"));
  assert.ok(has(result, "1.4.11", "review", "#faint-input"));
  assert.ok(!result.findings.some((f) => f.selector === "#clear-input"));
  assert.ok(has(result, "4.1.3", "review", "#toast"));
  assert.ok(result.checked.includes("2.5.4"));
});

test("操作: 問題のないページでは指摘が出ない", async () => {
  const result = await checkInteraction({ url: fixture("good.html") });
  assert.deepEqual(result.findings, []);
  // 入力欄があるページでは、ステータスメッセージの有無を内容から判断する必要がある。
  assert.ok(result.needsJudgment?.includes("4.1.3"));

  const plain = await checkInteraction({ url: fixture("site/index.html") });
  assert.ok(plain.inapplicable?.includes("4.1.3"));
  assert.ok(plain.inapplicable?.includes("3.2.2"));
});

test("判断材料: 問いと材料とスクリーンショットを返す", async () => {
  const result = await collectEvidence({ url: fixture("evidence.html") });
  const item = (id: string) => result.items.find((i) => i.id === id);
  assert.ok(item("1.1.1")?.question);
  assert.equal((item("1.1.1")?.evidence.images as { alt: string }[])[0]?.alt, "IMG_0042.jpg");
  assert.equal((item("1.3.3")?.evidence.candidates as { selector: string }[])[0]?.selector, "#hint");
  const link = (item("2.4.4")?.evidence.links as { selector: string; generic?: boolean; context?: string }[]).find((l) => l.selector === "#here");
  assert.equal(link?.generic, true);
  assert.match(link?.context ?? "", /料金の説明/);
  assert.deepEqual((item("2.4.6")?.evidence.headings as { text: string }[]).map((h) => h.text), ["判断が必要なページ", "その他"]);
  const mismatch = (item("1.3.2")?.evidence.visualOrderMismatches as { laterInHtml: string }[])[0];
  assert.equal(mismatch?.laterInHtml, "#first");
  assert.equal(result.screenshots.length, 1);
  // JPEG は FF D8 で始まる。
  assert.equal(Buffer.from(result.screenshots[0]!.data, "base64").subarray(0, 2).toString("hex"), "ffd8");
});

test("判断材料: 達成基準を絞り込める", async () => {
  const result = await collectEvidence({ url: fixture("evidence.html"), criteria: ["2.4.4"], screenshot: false });
  assert.deepEqual(result.items.map((i) => i.id), ["2.4.4"]);
  assert.equal(result.screenshots.length, 0);
});

test("スクリーンショット: 要素を指定して撮影できる", async () => {
  const shot = await captureScreenshot({ url: fixture("evidence.html"), selector: "#photo" });
  assert.equal(shot.mimeType, "image/jpeg");
  assert.ok(shot.data.length > 100);
});

test("監査: 判断を渡すと状態に反映し、すべて解消すると no_failure_found になる", async () => {
  const url = fixture("good.html");
  const before = await auditPage({ url });
  const pending = before.criteria.filter((c) => c.status === "needs_judgment" || c.status === "manual").map((c) => c.id);
  assert.ok(pending.includes("2.4.4"));
  assert.equal(before.conformance.verdict, "undetermined");

  const after = await auditPage({ url, judgments: pending.map((id) => ({ id, verdict: "pass" as const, reason: "テスト用の判断" })) });
  assert.equal(after.criteria.find((c) => c.id === "2.4.4")?.status, "judged_pass");
  assert.equal(after.criteria.find((c) => c.id === "2.4.4")?.judgment?.reason, "テスト用の判断");
  assert.equal(after.conformance.verdict, "no_failure_found");
});

test("監査: 判断で不適合にでき、自動検査の不適合は判断で覆せない", async () => {
  const judged = await auditPage({ url: fixture("good.html"), judgments: [{ id: "2.4.6", verdict: "fail", reason: "見出しが内容と合わない", evidence: "h1" }] });
  assert.equal(judged.criteria.find((c) => c.id === "2.4.6")?.status, "fail");
  assert.equal(judged.conformance.verdict, "nonconformant");

  // 根拠の箇所がない不適合と、決められないという答えは、要確認にとどめる。
  const weak = await auditPage({
    url: fixture("good.html"),
    judgments: [
      { id: "2.4.6", verdict: "fail", reason: "見出しが内容と合わない" },
      { id: "2.4.4", verdict: "unsure", reason: "行き先を確かめられない" },
    ],
  });
  assert.equal(weak.criteria.find((c) => c.id === "2.4.6")?.status, "review");
  assert.match(weak.criteria.find((c) => c.id === "2.4.6")?.note ?? "", /根拠/);
  assert.equal(weak.criteria.find((c) => c.id === "2.4.4")?.status, "review");
  assert.equal(weak.conformance.verdict, "undetermined");

  const overridden = await auditPage({ url: fixture("axe-bad.html"), judgments: [{ id: "1.1.1", verdict: "pass", reason: "問題なし" }] });
  const row = overridden.criteria.find((c) => c.id === "1.1.1");
  assert.equal(row?.status, "fail");
  assert.match(row?.note ?? "", /反映していません/);
});

test("判断材料: canvas や svg の画像、支援技術から隠された画像、タイトル、言語、エラーの文言を返す", async () => {
  const result = await collectEvidence({ url: fixture("evidence-more.html"), screenshot: false });
  const item = (id: string) => result.items.find((i) => i.id === id);

  const images = item("1.1.1")?.evidence.images as { selector: string; tag: string; name: string | null; ignoredByAssistiveTech: boolean }[];
  const image = (selector: string) => images.find((i) => i.selector === selector);
  assert.equal(image("#drawn")?.tag, "canvas");
  assert.equal(image("#drawn")?.name, "会社のロゴ");
  assert.equal(image("#titled")?.name, "星の印");
  assert.equal(image("#hidden-photo")?.ignoredByAssistiveTech, true);
  assert.equal(image("#drawn")?.ignoredByAssistiveTech, false);

  assert.equal(item("2.4.2")?.evidence.title, "りんごの収穫時期");
  assert.equal(item("3.1.1")?.evidence.lang, "en");
  assert.match(String(item("3.1.1")?.evidence.textInPageLanguage), /日本語で書かれています/);
  assert.deepEqual((item("3.1.2")?.evidence.parts as { selector: string; lang: string }[]).map((p) => [p.selector, p.lang]), [["#french", "fr"]]);
  const message = (item("3.3.1")?.evidence.messages as { selector: string; label: string; message: string }[]).find((m) => m.selector === "#age");
  assert.equal(message?.label, "年齢");
  assert.equal(message?.message, "入力に誤りがあります。");
  assert.ok(item("2.4.9")?.question);
});
