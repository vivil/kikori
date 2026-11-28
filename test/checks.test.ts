import assert from "node:assert/strict";
import { test } from "node:test";
import { auditPage } from "../src/checks/audit.js";
import { checkAxe, criteriaFromTags } from "../src/checks/axe.js";
import { checkKeyboardFocus } from "../src/checks/focus.js";
import { checkPresentation } from "../src/checks/presentation.js";
import { checkReflow } from "../src/checks/reflow.js";
import { checkTextSpacing } from "../src/checks/textSpacing.js";
import { assertAllowedUrl } from "../src/browser.js";
import type { CheckResult, Severity } from "../packages/core/src/types.js";

// コンパイル後は dist/test に置かれるので、リポジトリ直下の test/fixtures を指す。
const fixture = (name: string): string => new URL(`../../test/fixtures/${name}`, import.meta.url).href;

const has = (result: CheckResult, sc: string, severity: Severity, selector: string): boolean =>
  result.findings.some((f) => f.sc.id === sc && f.severity === severity && f.selector === selector);

test("問題のないページでは指摘が出ない", async () => {
  const url = fixture("good.html");
  for (const result of [await checkReflow({ url }), await checkTextSpacing({ url }), await checkKeyboardFocus({ url })]) {
    assert.deepEqual(result.findings, [], `${result.check} で想定外の指摘が出た`);
  }
});

test("リフロー: 横スクロールを起こす要素を不適合として報告する", async () => {
  const result = await checkReflow({ url: fixture("reflow-bad.html") });
  assert.ok(has(result, "1.4.10", "fail", "#wide"));
  assert.ok(Number(result.data?.documentScrollWidth) > 320);
});

test("リフロー: 表のはみ出しは要確認にとどめる", async () => {
  const result = await checkReflow({ url: fixture("reflow-bad.html") });
  const table = result.findings.find((f) => f.selector.startsWith("#table-wrap"));
  assert.equal(table?.severity, "review");
});

test("リフロー: 狭めたときに切れる文字を報告する", async () => {
  const result = await checkReflow({ url: fixture("reflow-bad.html") });
  assert.ok(has(result, "1.4.10", "review", "#title"));
});

test("テキスト間隔: 切れる文字と重なる文字を報告し、伸びる要素は報告しない", async () => {
  const result = await checkTextSpacing({ url: fixture("text-spacing-bad.html") });
  assert.ok(has(result, "1.4.12", "fail", "#clipped"));
  assert.ok(has(result, "1.4.12", "fail", "#spill"));
  assert.ok(!result.findings.some((f) => f.selector === "#ok"));
});

test("フォーカス: 表示のない要素と隠れる要素を報告する", async () => {
  const result = await checkKeyboardFocus({ url: fixture("focus-bad.html") });
  assert.ok(has(result, "2.4.7", "fail", "#no-ring"));
  assert.ok(has(result, "2.4.11", "fail", "#covered"));
  assert.ok(!result.findings.some((f) => f.sc.id === "2.4.7" && f.selector !== "#no-ring"));
});

test("フォーカス: 順序の一覧を返し、正の tabindex を要確認にする", async () => {
  const result = await checkKeyboardFocus({ url: fixture("focus-bad.html") });
  const sequence = result.data?.sequence as { selector: string }[];
  assert.deepEqual(
    sequence.map((s) => s.selector),
    ["#jump", "#ok-link", "#no-ring", "#covered", "#late"],
  );
  assert.equal(result.data?.completedCycle, true);
  assert.ok(has(result, "2.4.3", "review", "#jump"));
});

test("フォーカス: キーボードで届かない操作部品を報告する", async () => {
  const result = await checkKeyboardFocus({ url: fixture("focus-bad.html") });
  assert.ok(has(result, "2.1.1", "fail", "#fake-button"));
  assert.ok(has(result, "2.1.1", "review", "#click-only"));
});

test("フォーカス: 抜け出せない箇所を報告する", async () => {
  const result = await checkKeyboardFocus({ url: fixture("trap.html") });
  const trap = result.findings.find((f) => f.sc.id === "2.1.2");
  assert.equal(trap?.selector, "#one");
  assert.deepEqual(trap?.details?.loop, ["#one", "#two"]);
});

test("http / https / file 以外の URL は拒否する", () => {
  assert.throws(() => assertAllowedUrl("javascript:alert(1)"));
  assert.throws(() => assertAllowedUrl("not a url"));
  assert.equal(assertAllowedUrl("http://localhost:3000/").protocol, "http:");
});

test("file: の URL は、許可したディレクトリの中の HTML だけを開く", () => {
  assert.equal(assertAllowedUrl(fixture("good.html")).protocol, "file:");
  assert.throws(() => assertAllowedUrl("file:///etc/passwd"), /の中だけ/);
  assert.throws(() => assertAllowedUrl(new URL("../../package.json", import.meta.url).href), /拡張子/);
  assert.throws(() => assertAllowedUrl(fixture("missing.html")), /見つかりません/);
  // ホスト名つきの URL は、ファイルに触れる前に断る。
  assert.throws(() => assertAllowedUrl("file://fileserver.example/share/page.html"), /ホスト名つき/);
  assert.equal(assertAllowedUrl(fixture("good.html").replace("file:///", "file://localhost/")).protocol, "file:");
});

test("axe: 代替テキスト、コントラスト、ラベル、言語の不備を達成基準つきで報告する", async () => {
  const result = await checkAxe({ url: fixture("axe-bad.html") });
  assert.ok(has(result, "1.1.1", "fail", "#no-alt"));
  assert.ok(has(result, "1.4.3", "fail", "#faint"));
  assert.ok(has(result, "4.1.2", "fail", "#unlabelled"));
  assert.ok(has(result, "3.1.1", "fail", "html"));
  assert.ok(!result.findings.some((f) => f.sc.level === "AAA"));
  assert.ok(result.checked.includes("2.4.2"));
});

test("axe: レベル AAA を指定すると、高度なコントラストも調べる", async () => {
  const result = await checkAxe({ url: fixture("axe-bad.html"), level: "AAA" });
  assert.ok(has(result, "1.4.6", "fail", "#dim"));
});

test("axe のタグを達成基準に変換する", () => {
  assert.deepEqual(criteriaFromTags(["cat.color", "wcag2aa", "wcag143", "wcag1410"]).map((sc) => sc.id), ["1.4.3", "1.4.10"]);
});

test("提示: 小さいターゲット、文章の体裁、動き続ける要素を報告する", async () => {
  const result = await checkPresentation({ url: fixture("presentation-bad.html") });
  assert.ok(has(result, "2.5.5", "fail", "#small"));
  assert.ok(!result.findings.some((f) => f.selector === "#big" || f.selector === "#inline" || f.selector === "#fine"));
  assert.ok(has(result, "1.4.8", "fail", "#justified"));
  assert.ok(has(result, "1.4.8", "fail", "#tight"));
  assert.ok(has(result, "1.4.8", "review", "#long"));
  assert.ok(has(result, "2.2.2", "review", "#spinner"));
  assert.ok(result.inapplicable?.includes("1.2.2"));
});

test("見た目: 宣言のない動きを、画面の撮り比べから見つける", async () => {
  const result = await checkPresentation({ url: fixture("motion-bad.html") });
  const moving = result.findings.filter((f) => f.sc.id === "2.2.2");
  // スクリプトが書き換え続ける部分は、撮り比べで見つかる。
  const ticker = moving.find((f) => f.selector === "#ticker");
  assert.equal(ticker?.severity, "review");
  assert.equal(ticker?.details?.detectedBy, "frames");
  // CSS のアニメーションは宣言から見つかり、撮り比べの側では重ねて報告しない。
  assert.deepEqual(moving.filter((f) => f.selector === "#spinner").map((f) => f.details?.detectedBy), ["declared"]);
  assert.ok(!moving.some((f) => f.selector === "#still"));

  // 動きのないページでは、何も報告しない。
  const quiet = await checkPresentation({ url: fixture("good.html") });
  assert.ok(!quiet.findings.some((f) => f.sc.id === "2.2.2"));
});

test("監査: 全達成基準の状態を返し、適合とは判定しない", async () => {
  const aa = await auditPage({ url: fixture("good.html") });
  // 既定の対象は WCAG 2.2。レベル AA までで 55 件ある。
  assert.equal(aa.criteria.length, 55);
  assert.equal(aa.target, "WCAG 2.2 レベル AA");
  assert.equal(aa.conformance.verdict, "undetermined");
  assert.equal(aa.conformance.counts.fail, 0);
  const status = (id: string): string | undefined => aa.criteria.find((c) => c.id === id)?.status;
  assert.equal(status("1.4.10"), "no_issue_found");
  assert.equal(status("2.4.2"), "no_issue_found");
  assert.equal(status("1.2.2"), "inapplicable");
  assert.equal(status("3.2.3"), "manual");
  assert.equal(status("2.4.11"), "no_issue_found");
  assert.equal(status("4.1.1"), undefined);
  assert.deepEqual(aa.beyondTarget, []);

  const bad = await auditPage({ url: fixture("axe-bad.html"), level: "AAA" });
  assert.equal(bad.criteria.length, 86);

  // 2.1 を対象にすると、2.2 で追加された達成基準は判定から外れ、検査したものだけを別に返す。
  const old = await auditPage({ url: fixture("good.html"), wcag: "2.1" });
  assert.equal(old.criteria.length, 50);
  assert.equal(old.target, "WCAG 2.1 レベル AA");
  assert.equal(old.criteria.find((c) => c.id === "4.1.1")?.status, "no_issue_found");
  assert.equal(old.criteria.find((c) => c.id === "2.5.8"), undefined);
  assert.ok(old.beyondTarget.some((c) => c.id === "2.4.11"));
  assert.ok(old.beyondTarget.some((c) => c.id === "2.5.8"));
  assert.equal(bad.conformance.verdict, "nonconformant");
  assert.equal(bad.criteria.find((c) => c.id === "1.1.1")?.status, "fail");
});
