import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { checkKeyboardFocus } from "../src/checks/focus.js";
import { checkPresentation } from "../src/checks/presentation.js";
import { auditSite, type SiteResult } from "../src/checks/site.js";

const fixtures = new URL("../../test/fixtures/", import.meta.url);
let server: Server;
let origin: string;
let result: SiteResult;

before(async () => {
  // リンクをたどる動作は同じオリジンで判定するので、フィクスチャを HTTP で配信する。
  server = createServer(async (req, res) => {
    try {
      const body = await readFile(new URL(`.${new URL(req.url ?? "/", "http://x").pathname}`, fixtures));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  result = await auditSite({ url: `${origin}/site/index.html`, level: "AAA" });
});

after(() => server.close());

const cross = (sc: string) => result.crossPage.findings.filter((f) => f.sc.id === sc);
const status = (id: string): string | undefined => result.criteria.find((c) => c.id === id)?.status;

test("サイト: 起点のページからリンクをたどって検査する", () => {
  assert.deepEqual(
    result.pages.map((p) => p.url.replace(origin, "")).sort(),
    ["/site/about.html", "/site/contact.html", "/site/index.html", "/site/sitemap.html"],
  );
});

test("サイト: ナビゲーションの並び順の違いを不適合として報告する", () => {
  const [finding] = cross("3.2.3");
  assert.equal(finding?.severity, "fail");
  assert.equal(finding?.details?.page, `${origin}/site/contact.html`);
  assert.deepEqual(finding?.details?.order, ["トップへ戻る", "お問い合わせ", "会社概要"]);
  assert.equal(status("3.2.3"), "fail");
});

test("サイト: 同じ行き先で名前が違うリンクと、重複したタイトルを報告する", () => {
  const names = (cross("3.2.4")[0]?.details?.names as { name: string }[]).map((n) => n.name);
  assert.deepEqual(names.sort(), ["トップへ戻る", "ホーム"]);
  assert.equal(cross("2.4.2")[0]?.details?.title, "会社概要 | サンプル商店");
});

test("サイト: たどり着く手段が 2 つあれば 2.4.5 を指摘せず、現在位置の手がかりがなければ要確認にする", () => {
  assert.equal(cross("2.4.5").length, 0);
  assert.equal(status("2.4.5"), "no_issue_found");
  assert.equal(cross("2.4.8").length, 4);
});

test("サイト: ページごとの指摘も達成基準の状態に反映する", () => {
  assert.equal(result.conformance.verdict, "nonconformant");
  assert.equal(status("1.3.5"), "review");
  assert.equal(status("4.1.1"), "no_issue_found");
  assert.equal(result.criteria.length, 78);
});

test("サイト: urls を指定すると、リンクをたどらずその一覧だけを検査する", async () => {
  const two = await auditSite({ url: `${origin}/site/index.html`, urls: [`${origin}/site/about.html`] });
  assert.equal(two.pages.length, 2);
  assert.equal(two.crossPage.findings.length, 0);
  assert.equal(two.criteria.find((c) => c.id === "3.2.3")?.status, "no_issue_found");
});

test("フォーカス: フォーカスしただけでページが移動する欄を報告する", async () => {
  const focus = await checkKeyboardFocus({ url: `${origin}/focus-jump.html` });
  const finding = focus.findings.find((f) => f.sc.id === "3.2.1");
  assert.equal(finding?.severity, "fail");
  assert.equal(finding?.selector, "#safe");
});

test("提示: autocomplete のない個人情報の欄を要確認にし、入力欄がなければ該当なしにする", async () => {
  const contact = await checkPresentation({ url: `${origin}/site/contact.html` });
  assert.ok(contact.findings.some((f) => f.sc.id === "1.3.5" && f.selector === "#mail" && f.details?.hint === "email"));
  const home = await checkPresentation({ url: `${origin}/site/index.html` });
  assert.ok(home.inapplicable?.includes("3.3.1"));
});
