import assert from "node:assert/strict";
import { test } from "node:test";
import { auditPage } from "../src/checks/audit.js";
import { checkKeyboardFocus } from "../src/checks/focus.js";
import { checkInteraction } from "../src/checks/interaction.js";
import { checkPresentation } from "../src/checks/presentation.js";
import { criteriaOf } from "../src/criteria.js";
import type { CheckResult, Severity } from "../src/types.js";

const fixture = (name: string): string => new URL(`../../test/fixtures/${name}`, import.meta.url).href;
const url = fixture("wcag22-bad.html");
const has = (result: CheckResult, sc: string, severity: Severity, selector: string): boolean =>
  result.findings.some((f) => f.sc.id === sc && f.severity === severity && f.selector === selector);

test("達成基準の一覧: 2.2 は 4.1.1 を外し、9 件を加える", () => {
  const v21 = criteriaOf("2.1").map((c) => c.id);
  const v22 = criteriaOf("2.2").map((c) => c.id);
  assert.equal(v21.length, 78);
  assert.equal(v22.length, 86);
  assert.ok(v21.includes("4.1.1") && !v22.includes("4.1.1"));
  for (const id of ["2.4.11", "2.4.12", "2.4.13", "2.5.7", "2.5.8", "3.2.6", "3.3.7", "3.3.8", "3.3.9"]) assert.ok(v22.includes(id) && !v21.includes(id), id);
  // 番号の順に並ぶ。2.4.10 のあとに 2.4.11 が来る。
  assert.deepEqual(v22.slice(v22.indexOf("2.4.9"), v22.indexOf("2.4.9") + 4), ["2.4.9", "2.4.10", "2.4.11", "2.4.12"]);
});

test("2.5.8: 24px に届かず間隔も足りないターゲットだけを不適合にする", async () => {
  const result = await checkPresentation({ url });
  assert.ok(has(result, "2.5.8", "fail", "#close-a"));
  assert.ok(has(result, "2.5.8", "fail", "#close-b"));
  // 周りに十分な間隔があるものは、例外として認められる。
  assert.ok(!result.findings.some((f) => f.sc.id === "2.5.8" && f.selector === "#lonely"));
  // 44px の基準 (AAA) では、どれも小さい。
  assert.ok(has(result, "2.5.5", "fail", "#lonely"));
});

test("2.4.12 / 2.4.13: 一部が隠れるフォーカスと、細いフォーカス表示を報告する", async () => {
  const result = await checkKeyboardFocus({ url });
  assert.ok(has(result, "2.4.12", "fail", "#half-covered"));
  assert.ok(!result.findings.some((f) => f.sc.id === "2.4.11"));
  assert.ok(has(result, "2.4.13", "review", "#thin"));
  assert.ok(!result.findings.some((f) => f.sc.id === "2.4.13" && f.selector === "#close-a"));
});

test("2.5.7 / 3.3.8: ドラッグで操作する要素と、認証を妨げる指定を報告する", async () => {
  const result = await checkInteraction({ url });
  assert.ok(has(result, "2.5.7", "review", "#card"));
  assert.ok(has(result, "3.3.8", "fail", "#no-paste"));
  assert.ok(has(result, "3.3.8", "review", "#no-fill"));
  assert.ok(has(result, "3.3.8", "review", "#captcha-box"));
  assert.ok(has(result, "3.3.9", "review", "#captcha-box"));

  const plain = await checkInteraction({ url: fixture("good.html") });
  assert.ok(plain.inapplicable?.includes("3.3.8"));
  assert.ok(plain.checked.includes("2.5.7"));
});

test("監査: 2.2 を対象にすると新しい達成基準が判定に入り、2.1 では入らない", async () => {
  const v22 = await auditPage({ url });
  assert.equal(v22.criteria.find((c) => c.id === "2.5.8")?.status, "fail");
  assert.equal(v22.criteria.find((c) => c.id === "3.3.8")?.status, "fail");
  assert.equal(v22.conformance.verdict, "nonconformant");

  const v21 = await auditPage({ url, wcag: "2.1" });
  assert.equal(v21.criteria.find((c) => c.id === "2.5.8"), undefined);
  assert.equal(v21.beyondTarget.find((c) => c.id === "2.5.8")?.status, "fail");
  assert.equal(v21.conformance.counts.fail, v21.criteria.filter((c) => c.status === "fail").length);
});
