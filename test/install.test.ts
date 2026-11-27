import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { launchWithInstall, MissingBrowserError, packageVersion } from "../src/install.js";

const entry = fileURLToPath(new URL("../src/index.js", import.meta.url));
const fixture = new URL("../../test/fixtures/good.html", import.meta.url).href;

test("install: 依存している Playwright に、検査用のブラウザを入れさせる", () => {
  // --dry-run は、何を入れるかを表示するだけで、ダウンロードはしない。
  const result = spawnSync(process.execPath, [entry, "install", "--dry-run"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /chromium[-_ ]headless[-_ ]shell/i);
  assert.doesNotMatch(result.stdout, /firefox|webkit/i);
});

test("自動取得を止めているときは、次に打つコマンドを案内する", () => {
  const script = `
    const { checkReflow } = await import(${JSON.stringify(new URL("../src/checks/reflow.js", import.meta.url).href)});
    try { await checkReflow({ url: ${JSON.stringify(fixture)} }); console.log("no error"); }
    catch (error) { console.log(error.message); }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "/nonexistent-kikori-browsers", KIKORI_LANG: "en", KIKORI_NO_AUTO_INSTALL: "1" },
  });
  assert.match(result.stdout, /Run `npx kikori install`/);
  assert.doesNotMatch(result.stdout, /Looks like Playwright/);
});

test("サーバーが名乗るバージョンは、package.json と一致する", () => {
  assert.match(packageVersion(), /^\d+\.\d+\.\d+/);
});

const missing = (): Error => new Error("browserType.launch: Executable doesn't exist at /somewhere/chrome");

test("ブラウザがなければ 1 度だけ取得し、起動し直す", async () => {
  let launches = 0;
  let downloads = 0;
  const launch = async (): Promise<string> => {
    if (launches++ === 0) throw missing();
    return "browser";
  };
  const result = await launchWithInstall(launch, true, async () => {
    downloads++;
  });
  assert.equal(result, "browser");
  assert.equal(downloads, 1);
  assert.equal(launches, 2);
});

test("同時に始まった検査は、取得を 1 回にまとめる", async () => {
  let downloads = 0;
  let installed = false;
  const launch = async (): Promise<string> => {
    if (!installed) throw missing();
    return "browser";
  };
  const download = async (): Promise<void> => {
    downloads++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    installed = true;
  };
  const results = await Promise.all([launchWithInstall(launch, true, download), launchWithInstall(launch, true, download), launchWithInstall(launch, true, download)]);
  assert.deepEqual(results, ["browser", "browser", "browser"]);
  assert.equal(downloads, 1);
});

test("ブラウザがあるとき、ほかの理由で起動に失敗したとき、止めているときは、取得しない", async () => {
  let downloads = 0;
  const download = async (): Promise<void> => {
    downloads++;
  };
  assert.equal(await launchWithInstall(async () => "browser", true, download), "browser");
  await assert.rejects(
    launchWithInstall(async () => Promise.reject(new Error("sandbox failure")), true, download),
    /sandbox failure/,
  );
  await assert.rejects(
    launchWithInstall(async () => Promise.reject(missing()), false, download),
    MissingBrowserError,
  );
  assert.equal(downloads, 0);
});

test("取得に失敗したら、その内容を添えて知らせる", async () => {
  const failing = launchWithInstall(
    async () => Promise.reject(missing()),
    true,
    async () => Promise.reject(new Error("network unreachable")),
  );
  await assert.rejects(failing, (error: unknown) => error instanceof MissingBrowserError && error.downloadFailure === "network unreachable");
});
