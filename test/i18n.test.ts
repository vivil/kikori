import assert from "node:assert/strict";
import { after, test } from "node:test";
import { auditPage } from "../src/checks/audit.js";
import { configure, getSettings, usage } from "../src/config.js";
import { collectEvidence } from "../src/evidence.js";
import { createServer } from "../src/server.js";

const fixture = (name: string): string => new URL(`../../test/fixtures/${name}`, import.meta.url).href;
const JAPANESE = /[ぁ-んァ-ヶ一-龠]/;
const original = getSettings();

after(() => configure(original));

/** フィクスチャの本文から引いた文字列を除いて、こちらが作った文面だけを取り出す。 */
function ownText(value: unknown): string {
  return JSON.stringify(value, (key, v: unknown) => (["text", "overlapsWithText", "selector", "html", "title", "url", "loop", "sequence", "evidence"].includes(key) ? undefined : v));
}

test("英語: 監査の結果に日本語が混ざらず、達成基準の名前も英語になる", async () => {
  configure({ ...original, lang: "en" });
  for (const name of ["focus-bad.html", "interaction-bad.html", "presentation-bad.html", "reflow-bad.html", "text-spacing-bad.html", "axe-bad.html"]) {
    const result = await auditPage({ url: fixture(name), level: "AAA" });
    const text = ownText(result);
    assert.ok(!JAPANESE.test(text), `${name}: ${JAPANESE.exec(text)?.index !== undefined ? text.slice(Math.max(0, JAPANESE.exec(text)!.index - 80), JAPANESE.exec(text)!.index + 40) : ""}`);
    assert.equal(result.criteria.find((c) => c.id === "1.4.10")?.name, "Reflow");
    assert.equal(result.target, "WCAG 2.1 Level AAA");
  }
});

test("英語: 判断材料の問い、ツールの説明、使い方が英語になる", async () => {
  configure({ ...original, lang: "en" });
  const evidence = await collectEvidence({ url: fixture("evidence.html"), screenshot: false });
  assert.ok(!JAPANESE.test(evidence.instructions));
  for (const item of evidence.items) assert.ok(!JAPANESE.test(`${item.name} ${item.question} ${item.failWhen}`), item.id);

  const tools = (createServer() as unknown as { _registeredTools: Record<string, { title?: string; description?: string }> })._registeredTools;
  for (const [name, tool] of Object.entries(tools)) assert.ok(!JAPANESE.test(`${tool.title} ${tool.description}`), name);
  assert.ok(!JAPANESE.test(usage("en")));
});

test("日本語: 同じ結果が日本語で返る", async () => {
  configure({ ...original, lang: "ja" });
  const result = await auditPage({ url: fixture("reflow-bad.html") });
  assert.equal(result.criteria.find((c) => c.id === "1.4.10")?.name, "リフロー");
  assert.match(result.conformance.explanation, /不適合が見つかりました/);
  assert.match(usage("ja"), /使い方/);
});
