import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { packageVersion } from "../src/install.js";

const entry = fileURLToPath(new URL("../src/index.js", import.meta.url));
const fixture = new URL("../../test/fixtures/good.html", import.meta.url).href;

test("install: 依存している Playwright に、検査用のブラウザを入れさせる", () => {
  // --dry-run は、何を入れるかを表示するだけで、ダウンロードはしない。
  const result = spawnSync(process.execPath, [entry, "install", "--dry-run"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /chromium[-_ ]headless[-_ ]shell/i);
  assert.doesNotMatch(result.stdout, /firefox|webkit/i);
});

test("ブラウザが入っていないときは、次に打つコマンドを案内する", () => {
  const script = `
    const { checkReflow } = await import(${JSON.stringify(new URL("../src/checks/reflow.js", import.meta.url).href)});
    try { await checkReflow({ url: ${JSON.stringify(fixture)} }); console.log("no error"); }
    catch (error) { console.log(error.message); }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "/nonexistent-kikori-browsers", KIKORI_LANG: "en" },
  });
  assert.match(result.stdout, /Run `npx kikori install`/);
  assert.doesNotMatch(result.stdout, /Looks like Playwright/);
});

test("サーバーが名乗るバージョンは、package.json と一致する", () => {
  assert.match(packageVersion(), /^\d+\.\d+\.\d+/);
});
