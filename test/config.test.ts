import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { assertAllowedUrl, withPage } from "../src/browser.js";
import { checkReflow } from "../src/checks/reflow.js";
import { checkInteraction } from "../src/checks/interaction.js";
import { configure, filterStorageState, getSettings, isHostAllowed, LOOPBACK_HOSTS, parseArgs, type Settings } from "../src/config.js";

const settings = (hosts: string[] | null, frames: string[] = []): Settings => ({ lang: "ja", allowedHosts: hosts, allowedFrameHosts: frames, fileRoot: null, allowFile: true, autoInstall: true, storageState: null });
const original = getSettings();
let server: Server;
let port: number;
const pixelHits: string[] = [];
let toggleHits = 0;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/redirect") {
      // 許可していないホスト (localhost) へ転送する。
      res.writeHead(302, { location: `http://localhost:${port}/page` }).end();
      return;
    }
    if (req.url === "/toggle") {
      toggleHits++;
      res.writeHead(204).end();
      return;
    }
    if (req.url === "/settings") {
      // チェックを切り替えると、GET の通信で設定を書き換える作りのページ。
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html lang="ja"><title>設定</title><body><h1>設定</h1>
        <label><input id="notify" type="checkbox" onchange="fetch('/toggle')"> 通知を受け取る</label>
        <label><input id="beacon" type="checkbox" onchange="new Image().src = '/toggle'; navigator.sendBeacon('/toggle')"> 画像と送信用の API で切り替える</label>
        <label><input id="framed" type="checkbox" onchange="const f = document.createElement('iframe'); f.src = '/toggle'; document.body.append(f)"> iframe で切り替える</label></body></html>`);
      return;
    }
    if (req.url === "/members") {
      // セッションの Cookie を持っているときだけ、会員向けの内容を返す。
      const loggedIn = /(^|;\s*)session=valid(;|$)/.test(req.headers.cookie ?? "");
      if (!loggedIn) {
        res.writeHead(302, { location: "/login" }).end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html lang="ja"><title>会員ページ</title><body><h1 id="members">会員ページ</h1><p>ログイン後の内容です。</p></body></html>`);
      return;
    }
    if (req.url === "/login") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html lang="ja"><title>ログイン</title><body><h1 id="login">ログイン</h1><p>ログインしてください。</p></body></html>`);
      return;
    }
    if (req.url === "/pixel") {
      // どのホスト名あてに届いたかを記録する。
      pixelHits.push(req.headers.host ?? "");
      res.writeHead(200, { "content-type": "image/gif" });
      res.end(Buffer.from("R0lGODlhAQABAAAAACwAAAAAAQABAAA=", "base64"));
      return;
    }
    if (req.url === "/redirect-pixel") {
      res.writeHead(302, { location: `http://localhost:${port}/pixel` }).end();
      return;
    }
    if (req.url === "/with-redirected-image") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html lang="ja"><title>転送される画像</title><body><h1>転送される画像</h1><img alt="転送" src="/redirect-pixel"></body></html>`);
      return;
    }
    if (req.url === "/with-image") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html lang="ja"><title>画像のあるページ</title><body><h1>画像のあるページ</h1>
        <img alt="同じホスト" src="/pixel"><img alt="別のホスト" src="http://localhost:${port}/pixel"></body></html>`);
      return;
    }
    if (req.url === "/framed") {
      // 同じホストの iframe と、別のホスト (localhost) の iframe を 1 つずつ持つ。
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html lang="ja"><title>枠のあるページ</title><body><h1>枠のあるページ</h1>
        <iframe id="same" title="同じホスト" src="/inner"></iframe>
        <iframe id="other" title="別のホスト" src="http://localhost:${port}/inner"></iframe></body></html>`);
      return;
    }
    if (req.url === "/inner") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html lang="ja"><title>中身</title><body><p id="secret">枠の中の文章</p></body></html>`);
      return;
    }
    if (req.url === "/late") {
      // 読み込みのあと、同じホストの転送用の URL を経由して、許可していないホストへ移動する。
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html lang="ja"><title>あとで移動</title><body><h1>あとで移動</h1><script>setTimeout(() => (location.href = "/redirect"), 50)</script></body></html>`);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html lang="ja"><title>ページ</title><body><h1>ページ</h1><p>本文です。</p></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
});

after(() => {
  configure(original);
  server.close();
});

test("起動時の引数: ホストの一覧、file: の範囲、無効化を読む", () => {
  const { settings: parsed } = parseArgs(["--allow-host", "localhost:3000,Example.com", "--allow-host=*.example.org", "--allow-frame-host", "self,player.example.com", "--file-root", "/srv/site", "--no-file"], {});
  assert.deepEqual(parsed, {
    lang: "en",
    allowedHosts: ["localhost:3000", "example.com", "*.example.org"],
    allowedFrameHosts: ["self", "player.example.com"],
    fileRoot: "/srv/site",
    allowFile: false,
    autoInstall: true,
    storageState: null,
  });
  assert.equal(parseArgs(["--no-auto-install"], {}).settings.autoInstall, false);
  assert.equal(parseArgs([], { KIKORI_NO_AUTO_INSTALL: "1" }).settings.autoInstall, false);
  assert.deepEqual(parseArgs([], {}).settings, { lang: "en", allowedHosts: LOOPBACK_HOSTS, allowedFrameHosts: [], fileRoot: null, allowFile: true, autoInstall: true, storageState: null });
  // * を指定したときだけ、すべてのホストを開く。
  assert.equal(parseArgs(["--allow-host", "*"], {}).settings.allowedHosts, null);
  assert.equal(parseArgs([], { KIKORI_ALLOWED_HOSTS: "*" }).settings.allowedHosts, null);
  assert.deepEqual(parseArgs(["--allow-frame-host", "*"], {}).settings.allowedFrameHosts, ["*"]);
  assert.equal(parseArgs(["--help"], {}).help, true);
});

test("起動時の引数: 環境変数を読み、引数があればそちらを使う", () => {
  const env = { KIKORI_ALLOWED_HOSTS: "a.test", KIKORI_FILE_ROOT: "/env" };
  assert.deepEqual(parseArgs([], env).settings.allowedHosts, ["a.test"]);
  assert.deepEqual(parseArgs(["--allow-host", "b.test"], env).settings.allowedHosts, ["b.test"]);
  assert.equal(parseArgs(["--file-root", "/arg"], env).settings.fileRoot, "/arg");
});

test("起動時の引数: 誤った指定を拒否する", () => {
  const ja = { KIKORI_LANG: "ja" };
  assert.throws(() => parseArgs(["--allow-host"], ja), /値が必要/);
  assert.throws(() => parseArgs(["--allow-host", "http://example.com/"], ja), /解釈できません/);
  assert.throws(() => parseArgs(["--unknown"], ja), /知らないオプション/);
  assert.throws(() => parseArgs(["--unknown"], {}), /Unknown option/);
  assert.throws(() => parseArgs(["--lang", "fr"], {}), /must be ja or en/);
});

test("起動時の引数: 言語は、指定、環境変数、環境の言語設定の順に決まる", () => {
  assert.equal(parseArgs([], {}).settings.lang, "en");
  assert.equal(parseArgs([], { LANG: "ja_JP.UTF-8" }).settings.lang, "ja");
  assert.equal(parseArgs([], { LANG: "ja_JP.UTF-8", KIKORI_LANG: "en" }).settings.lang, "en");
  assert.equal(parseArgs(["--lang", "ja"], { KIKORI_LANG: "en" }).settings.lang, "ja");
});

test("ホストの照合: ポート、ワイルドカード、IPv6 を扱う", () => {
  const allowed = (url: string, hosts: string[] | null): boolean => isHostAllowed(new URL(url), settings(hosts));
  assert.equal(allowed("http://anything.test/", null), true);
  assert.equal(allowed("http://localhost:3000/a", ["localhost:3000"]), true);
  assert.equal(allowed("http://localhost:4000/a", ["localhost:3000"]), false);
  assert.equal(allowed("http://localhost:4000/a", ["localhost"]), true);
  assert.equal(allowed("https://example.com/", ["example.com:443"]), true);
  assert.equal(allowed("https://www.example.com/", ["*.example.com"]), true);
  assert.equal(allowed("https://example.com/", ["*.example.com"]), false);
  assert.equal(allowed("https://evilexample.com/", ["*.example.com"]), false);
  assert.equal(allowed("https://example.com.evil.test/", ["example.com"]), false);
  assert.equal(allowed("http://[::1]:8080/", ["[::1]:8080"]), true);
  assert.equal(allowed("http://169.254.169.254/", ["localhost"]), false);
  // ポートを省いた wss: は 443、ws: は 80 として照合する。
  assert.equal(allowed("wss://example.com/socket", ["example.com:443"]), true);
  assert.equal(allowed("wss://example.com/socket", ["example.com:80"]), false);
  assert.equal(allowed("ws://example.com/socket", ["example.com:80"]), true);
});

test("宛先の制限: 何も指定しなければ、自分のコンピューターのサーバーだけを開く", async () => {
  configure(parseArgs([], { KIKORI_LANG: "ja" }).settings);
  const ok = await checkReflow({ url: `http://127.0.0.1:${port}/page` });
  assert.equal(ok.check, "reflow");
  assert.equal(assertAllowedUrl("http://localhost:3000/").hostname, "localhost");
  assert.equal(assertAllowedUrl("http://app.localhost:5173/").hostname, "app.localhost");
  assert.throws(() => assertAllowedUrl("https://example.com/"), /開いてよいホストに含まれていません/);
  assert.throws(() => assertAllowedUrl("http://192.168.0.1/"), /開いてよいホスト/);
  assert.throws(() => assertAllowedUrl("http://localhost.example.com/"), /開いてよいホスト/);
});

test("宛先の制限: 許可したホストは検査でき、ほかのホストは開かない", async () => {
  configure(settings([`127.0.0.1:${port}`]));
  const ok = await checkReflow({ url: `http://127.0.0.1:${port}/page` });
  assert.equal(ok.check, "reflow");
  await assert.rejects(checkReflow({ url: `http://localhost:${port}/page` }), /開いてよいホストに含まれていません/);
  assert.throws(() => assertAllowedUrl("http://169.254.169.254/latest/meta-data/"), /開いてよいホスト/);
});

test("宛先の制限: 許可したホストから別のホストへ転送されたら、結果を返さない", async () => {
  configure(settings([`127.0.0.1:${port}`]));
  await assert.rejects(checkReflow({ url: `http://127.0.0.1:${port}/redirect` }), /開いてよいホストに含まれていません/);
});

test("宛先の制限: 読み込みのあとで別のホストへ転送されても、結果を返さない", async () => {
  configure(settings([`127.0.0.1:${port}`]));
  await assert.rejects(checkReflow({ url: `http://127.0.0.1:${port}/late`, waitMs: 400 }), /開いてよいホストに含まれていません/);
});

test("読み込み: 画像などの読み込みも、開いてよいホストの一覧に従う", async () => {
  configure(settings([`127.0.0.1:${port}`]));
  pixelHits.length = 0;
  const blocked = await checkReflow({ url: `http://127.0.0.1:${port}/with-image` });
  assert.deepEqual(pixelHits, [`127.0.0.1:${port}`]);
  assert.match(blocked.notes?.join("\n") ?? "", new RegExp(`1 件の宛先 \\(localhost:${port}\\) からの読み込みを止めました`));

  configure(settings([`127.0.0.1:${port}`, `localhost:${port}`]));
  pixelHits.length = 0;
  const allowed = await checkReflow({ url: `http://127.0.0.1:${port}/with-image` });
  assert.deepEqual(pixelHits.sort(), [`127.0.0.1:${port}`, `localhost:${port}`]);
  assert.equal(allowed.notes, undefined);
});

test("読み込み: 許可したホストが一覧にないホストへ転送したら、結果を返さない", async () => {
  configure(settings([`127.0.0.1:${port}`]));
  await assert.rejects(checkReflow({ url: `http://127.0.0.1:${port}/with-redirected-image` }), /へ転送されました/);
  configure(settings([`127.0.0.1:${port}`, `localhost:${port}`]));
  assert.equal((await checkReflow({ url: `http://127.0.0.1:${port}/with-redirected-image` })).check, "reflow");
});

/** それぞれの iframe の中身が読み込まれたかを調べる。 */
const loadedFrames = (): Promise<Record<string, boolean>> =>
  withPage({ url: `http://127.0.0.1:${port}/framed`, viewport: { width: 800, height: 600 }, waitMs: 200 }, async (page) => {
    const loaded: Record<string, boolean> = {};
    for (const id of ["same", "other"]) {
      const frame = await (await page.$(`#${id}`))!.contentFrame();
      loaded[id] = (await frame?.locator("#secret").count().catch(() => 0)) === 1;
    }
    return loaded;
  });

test("iframe: 既定ではすべての読み込みを止め、止めたことを結果に書く", async () => {
  configure(settings(null));
  const { same, other } = (await loadedFrames()) as { same: boolean; other: boolean };
  assert.deepEqual({ same, other }, { same: false, other: false });
  const result = await checkReflow({ url: `http://127.0.0.1:${port}/framed` });
  assert.match(result.notes?.join("\n") ?? "", /iframe の読み込みを 2 件止めました/);
});

test("iframe: self は同じホストだけを、ホストの指定はそのホストだけを、* はすべてを許可する", async () => {
  const pick = async (frames: string[]): Promise<{ same: boolean; other: boolean }> => {
    configure(settings(null, frames));
    const { same, other } = (await loadedFrames()) as { same: boolean; other: boolean };
    return { same, other };
  };
  assert.deepEqual(await pick(["self"]), { same: true, other: false });
  assert.deepEqual(await pick([`localhost:${port}`]), { same: false, other: true });
  assert.deepEqual(await pick(["*"]), { same: true, other: true });
});

test("file: のページは、許可したディレクトリの外のファイルを、移動でも iframe でも読めない", async () => {
  configure(settings(null, ["self"]));
  const url = new URL("../../test/fixtures/good.html", import.meta.url).href;
  const viewport = { width: 800, height: 600 };

  // 移動は止めるか、止められなければ結果を返さない。どちらでも中身は外に出ない。
  const moved = await withPage({ url, viewport }, async (page) => {
    await page.evaluate(() => (location.href = "file:///etc/hostname")).catch(() => undefined);
    await page.waitForTimeout(300);
    return { url: page.url(), text: await page.locator("body").innerText().catch(() => "") };
  }).catch(() => ({ url: "rejected", text: "" }));
  assert.ok(!moved.url.includes("/etc/hostname"));
  assert.equal(moved.text.trim() === "" || moved.text.includes("問題のないページ"), true);

  const framed = await withPage({ url, viewport }, async (page) => {
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.id = "outside";
      frame.src = "file:///etc/hostname";
      document.body.append(frame);
    });
    await page.waitForTimeout(300);
    const frame = await (await page.$("#outside"))!.contentFrame();
    return { text: (await frame?.locator("body").innerText().catch(() => "")) ?? "" };
  }).catch(() => ({ text: "" }));
  assert.equal(framed.text.trim(), "");
});

test("ログイン済みの状態: 指定すると、ログイン後のページを開ける", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kikori-state-"));
  const file = path.join(dir, "state.json");
  writeFileSync(
    file,
    JSON.stringify({
      cookies: [{ name: "session", value: "valid", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
      origins: [],
    }),
  );
  const heading = (): Promise<string> =>
    withPage({ url: `http://127.0.0.1:${port}/members`, viewport: { width: 800, height: 600 } }, (page) => page.locator("h1").innerText());

  configure(settings([`127.0.0.1:${port}`]));
  assert.equal(await heading(), "ログイン");

  configure({ ...settings([`127.0.0.1:${port}`]), storageState: file });
  assert.equal(await heading(), "会員ページ");
  const audited = await checkReflow({ url: `http://127.0.0.1:${port}/members` });
  assert.equal(audited.check, "reflow");
});

test("ログイン済みの状態: 開いてよいホストに属さない Cookie とローカルストレージは持ち込まない", () => {
  const state = {
    cookies: [
      { name: "a", domain: "app.example.com", secure: true },
      { name: "b", domain: ".example.com", secure: true },
      { name: "c", domain: "tracker.test", secure: false },
      { name: "d", domain: "localhost", secure: false },
    ],
    origins: [{ origin: "https://app.example.com" }, { origin: "https://tracker.test" }],
  };
  const only = (hosts: string[] | null): { cookies: string[]; origins: string[] } => {
    const filtered = filterStorageState(state, settings(hosts));
    return { cookies: filtered.cookies.map((c) => c.name), origins: filtered.origins.map((o) => o.origin) };
  };
  // .example.com の Cookie は app.example.com にも送られるので、残す。
  assert.deepEqual(only(["app.example.com"]), { cookies: ["a", "b"], origins: ["https://app.example.com"] });
  assert.deepEqual(only(["*.example.com"]), { cookies: ["a", "b"], origins: ["https://app.example.com"] });
  assert.deepEqual(only(["other.example.com"]), { cookies: ["b"], origins: [] });
  // ポートつきの指定でも、Cookie はホスト名で照合する。
  assert.deepEqual(only(["localhost:3000"]), { cookies: ["d"], origins: [] });
  assert.deepEqual(only(["example.org"]), { cookies: [], origins: [] });
  // すべてのホストを許可しているときは、そのまま使う。
  assert.equal(only(null).cookies.length, 4);
});

test("ログイン済みの状態: 操作を試す間は、スクリプトからの通信を止める", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kikori-state-"));
  const file = path.join(dir, "state.json");
  writeFileSync(file, JSON.stringify({ cookies: [{ name: "session", value: "valid", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] }));
  const url = `http://127.0.0.1:${port}/settings`;

  // 状態を読み込んでいなければ、チェックの切り替えで通信が届く。
  // iframe の読み込みも許可して、iframe を使う経路まで確かめる。
  configure(settings([`127.0.0.1:${port}`], ["self"]));
  toggleHits = 0;
  await checkInteraction({ url });
  assert.ok(toggleHits >= 3);

  configure({ ...settings([`127.0.0.1:${port}`], ["self"]), storageState: file });
  toggleHits = 0;
  const frozen = await checkInteraction({ url });
  assert.equal(toggleHits, 0);
  assert.match(frozen.notes?.join("\n") ?? "", /通信をすべて止めました/);
});

test("ログイン済みの状態: ファイルを読めないときは、起動時に知らせる", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kikori-state-"));
  const broken = path.join(dir, "broken.json");
  writeFileSync(broken, "not json");
  const ja = { KIKORI_LANG: "ja" };
  assert.throws(() => parseArgs(["--storage-state", path.join(dir, "missing.json")], ja), /--storage-state のファイルを読めません/);
  assert.throws(() => parseArgs(["--storage-state", broken], ja), /--storage-state のファイルを読めません/);
  assert.throws(() => parseArgs([], { KIKORI_STORAGE_STATE: broken }), /Cannot read the --storage-state file/);
});

test("宛先の制限: file: の URL を無効にできる", () => {
  configure({ lang: "ja", allowedHosts: null, allowedFrameHosts: [], fileRoot: null, allowFile: false, autoInstall: true, storageState: null });
  const fixture = new URL("../../test/fixtures/good.html", import.meta.url).href;
  assert.throws(() => assertAllowedUrl(fixture), /受け付けない設定/);
  configure(original);
  assert.equal(assertAllowedUrl(fixture).protocol, "file:");
});
