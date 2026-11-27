import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAxe } from "../src/checks/axe.js";
import { checkKeyboardFocus } from "../src/checks/focus.js";
import { checkInteraction } from "../src/checks/interaction.js";
import { checkPresentation } from "../src/checks/presentation.js";

// React、Vue、Angular で同じ不具合を仕込んだサンプル。どれでも同じ指摘が出ることを確かめる。
// まとめたスクリプトは scripts/build-fixtures.mjs が作る。
for (const framework of ["react", "vue", "angular"]) {
  const url = new URL(`../../test/fixtures/frameworks/${framework}.html`, import.meta.url).href;
  const options = { url, waitForSelector: "#ready" };

  test(`${framework}: 操作して確かめる検査が、フレームワーク経由の処理を検出する`, async () => {
    const result = await checkInteraction(options);
    const found = result.findings.map((f) => `${f.sc.id} ${f.severity} ${f.selector}`).sort();
    assert.deepEqual(found, ["1.4.13 fail #help", "2.1.4 review html", "2.5.2 review #pad", "3.2.2 fail #sort"]);
    assert.deepEqual(result.findings.find((f) => f.sc.id === "2.1.4")?.details?.keys, ["k"]);
    // 個々の要素の処理を読み取れたので、判断待ちにはしない。
    assert.ok(result.checked.includes("2.5.1") && result.checked.includes("2.5.2"));
    assert.ok(!result.needsJudgment?.includes("2.5.2"));
  });

  test(`${framework}: キーボードで届かないクリックの処理を検出し、フォーカス順を返す`, async () => {
    const result = await checkKeyboardFocus(options);
    assert.deepEqual(result.findings.map((f) => `${f.sc.id} ${f.severity} ${f.selector}`), ["2.1.1 review #card"]);
    assert.deepEqual((result.data?.sequence as { selector: string }[]).map((s) => s.selector), ["#email", "#help", "#sort", "#save"]);
    assert.equal(result.data?.completedCycle, true);
  });

  test(`${framework}: 描画後の DOM に対して、axe と入力目的の検査が働く`, async () => {
    const axe = await checkAxe(options);
    assert.deepEqual(axe.findings.filter((f) => f.severity === "fail"), []);
    assert.ok(axe.checked.includes("4.1.2"));
    const presentation = await checkPresentation(options);
    assert.ok(presentation.findings.some((f) => f.sc.id === "1.3.5" && f.selector === "#email"));
  });
}
