import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { checkAxe } from "../src/checks/axe.js";
import { checkKeyboardFocus } from "../src/checks/focus.js";
import { checkPresentation } from "../src/checks/presentation.js";
import { checkReflow } from "../src/checks/reflow.js";
import { checkTextSpacing } from "../src/checks/textSpacing.js";
import { configure, getSettings } from "../src/config.js";
import type { CheckResult, Severity } from "../packages/core/src/types.js";

const fixture = (name: string): string => new URL(`../../test/fixtures/${name}`, import.meta.url).href;
const has = (result: CheckResult, sc: string, severity: Severity, selector: string): boolean =>
  result.findings.some((f) => f.sc.id === sc && f.severity === severity && f.selector === selector);

const original = getSettings();
let server: Server;
let port: number;

before(async () => {
  const html = (body: string, head = ""): string => `<!doctype html><html lang="ja"><head><title>ページ</title>${head}</head><body>${body}</body></html>`;
  server = createServer((req, res) => {
    if (req.url === "/strict") {
      // インラインのスクリプトとスタイルを禁じる、厳しい Content Security Policy を付けたページ。
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'" });
      // インラインのスタイルはこのポリシーに止められるので、ページ自身のスタイルは外部ファイルに置く。
      res.end(html(`<h1>厳しい設定のページ</h1><p><img id="no-alt" src="/pixel.gif" width="20" height="20"></p><div id="clip">高さを固定した箱です。</div>`, `<link rel="stylesheet" href="/strict.css">`));
      return;
    }
    if (req.url === "/strict.css") {
      res.writeHead(200, { "content-type": "text/css" });
      res.end("#clip { width: 190px; height: 22px; overflow: hidden; font-size: 16px; line-height: 1.2; }");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (req.url === "/instant") res.end(html("<h1>移動する前のページ</h1>", `<meta http-equiv="refresh" content="0; URL='/landing'">`));
    else if (req.url === "/instant-away") res.end(html("<h1>外へ移動するページ</h1>", `<meta http-equiv="refresh" content="0; URL='http://localhost:${port}/landing'">`));
    else if (req.url === "/landing") res.end(html(`<h1>移動した先のページ</h1><div id="wide" style="width: 900px">幅を固定した領域です。</div>`));
    else res.end(html("<h1>ページ</h1>"));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
  configure({ ...original, lang: "ja", allowedHosts: [`127.0.0.1:${port}`] });
});

after(() => {
  configure(original);
  server.close();
});

test("すぐに別のページへ移るページでは、移った先を検査する", async () => {
  const result = await checkReflow({ url: `http://127.0.0.1:${port}/instant` });
  assert.ok(has(result, "1.4.10", "fail", "#wide"));
});

test("厳しい Content Security Policy のページでも、スクリプトやスタイルを差し込む検査が働く", async () => {
  const url = `http://127.0.0.1:${port}/strict`;
  const axe = await checkAxe({ url });
  assert.ok(has(axe, "1.1.1", "fail", "#no-alt"));
  // テキスト間隔の検査は、スタイルを上書きしてから測る。上書きが効かなければ、何も見つからない。
  const spacing = await checkTextSpacing({ url });
  assert.ok(has(spacing, "1.4.12", "fail", "#clip"));
});

test("すぐに許可していないホストへ移るページは、理由を添えて断る", async () => {
  await assert.rejects(checkReflow({ url: `http://127.0.0.1:${port}/instant-away` }), /localhost:\d+ へすぐに移動しようとしました/);
});

test("2.1.2: Tab を押してもフォーカスが動かない要素を報告する", async () => {
  configure({ ...original, lang: "ja" });
  const result = await checkKeyboardFocus({ url: fixture("trap-self.html") });
  const trap = result.findings.find((f) => f.sc.id === "2.1.2");
  assert.equal(trap?.selector, "#stuck");
  assert.equal(trap?.severity, "review");
  assert.equal(result.data?.completedCycle, false);
});

test("1.4.4: 200% に拡大すると切れる文字を、要確認として報告する", async () => {
  configure({ ...original, lang: "ja" });
  const result = await checkReflow({ url: fixture("zoom-bad.html") });
  assert.ok(has(result, "1.4.4", "review", "#fixed"));
  assert.ok(!result.findings.some((f) => f.selector === "#free"));
  assert.ok(result.checked.includes("1.4.4"));
});

test("1.4.2: 止める手段のない音声だけを不適合にする", async () => {
  configure({ ...original, lang: "ja" });
  const bad = await checkPresentation({ url: fixture("autoplay-bad.html") });
  assert.ok(has(bad, "1.4.2", "fail", "#endless"));

  // controls 属性があれば、指摘しない。
  const ok = await checkPresentation({ url: fixture("autoplay-ok.html") });
  assert.ok(!ok.findings.some((f) => f.sc.id === "1.4.2"));

  // 止めるためのボタンがありそうなときは、確認を求めるにとどめる。
  const button = await checkPresentation({ url: fixture("autoplay-button.html") });
  assert.ok(has(button, "1.4.2", "review", "#custom"));
});
