import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkAndroidScreen } from "../src/android/checks.js";
import { adbDevice, type Device } from "../src/android/device.js";
import { flatten, parseHierarchy } from "../src/android/tree.js";
import { parseArgs } from "../src/config.js";
import type { CheckResult, Severity } from "../../core/src/types.js";

/** 端末の代わりに、保存しておいた画面の階層を返す。密度 320 では、2px が 1dp になる。 */
const fake = (name: string, density = 320): Device => ({
  hierarchy: () => readFile(new URL(`../../../test/fixtures/android/${name}`, import.meta.url), "utf8"),
  density: async () => density,
  screenshot: async () => Buffer.alloc(0),
});
const has = (result: CheckResult, sc: string, severity: Severity, id: string): boolean =>
  result.findings.some((f) => f.sc.id === sc && f.severity === severity && f.selector.startsWith(`#${id} `));

test("Android: 画面の階層を読み、文字参照を戻す", async () => {
  const nodes = flatten(parseHierarchy(await fake("bad.xml").hierarchy()));
  const row = nodes.find((node) => node.resourceId.endsWith("/row"));
  assert.equal(row?.children[0]?.text, "設定 & プライバシー");
  assert.deepEqual(row?.bounds, { left: 0, top: 500, right: 720, bottom: 620 });
  assert.equal(row?.clickable, true);
  assert.throws(() => parseHierarchy("<html></html>"));
});

test("Android: 名前のない操作部品を、画像かどうかで分けて報告する", async () => {
  const result = await checkAndroidScreen(fake("bad.xml"));
  assert.equal(result.url, "android://com.example.app");
  assert.deepEqual(result.viewport, { width: 360, height: 640 });
  assert.ok(has(result, "1.1.1", "fail", "menu"));
  assert.ok(has(result, "4.1.2", "fail", "mystery"));
  // 子の文言が名前になる行と、文言のあるボタンは報告しない。
  assert.ok(!result.findings.some((f) => /^#(row|save) /.test(f.selector) && ["1.1.1", "4.1.2"].includes(f.sc.id)));
  // システムの画面部品は対象にしない。
  assert.ok(!result.findings.some((f) => f.selector.includes("[0,0][20,20]")));
});

test("Android: 小さすぎるタッチターゲットを dp に換算して報告する", async () => {
  const result = await checkAndroidScreen(fake("bad.xml"));
  assert.ok(has(result, "2.5.8", "fail", "tiny_a"));
  assert.ok(has(result, "2.5.8", "fail", "tiny_b"));
  assert.ok(has(result, "2.5.5", "fail", "tiny_a"));
  assert.ok(!has(result, "2.5.5", "fail", "save"));
  // 46dp のボタンは WCAG の指摘にはせず、Android の指針に届かないものとして別に返す。
  assert.ok(!result.findings.some((f) => f.selector.startsWith("#ok ")));
  const guideline = (result.data?.platformGuidelines as { platform: string; source: string; items: { size: string }[] }[])[0]!;
  assert.equal(guideline.platform, "android");
  assert.match(guideline.source, /^https:\/\/developer\.android\.com\//);
  assert.deepEqual(guideline.items.map((t) => t.size), ["46x46dp"]);
  // 文の中に置かれた小さいターゲットは、例外にあたることがあるので要確認にとどめる。
  assert.ok(has(result, "2.5.8", "review", "inline_a"));
  assert.ok(!has(result, "2.5.8", "fail", "inline_a"));
});

test("Android: 階層の順序と画面上の位置が食い違う箇所を要確認にする", async () => {
  const result = await checkAndroidScreen(fake("bad.xml"));
  assert.ok(has(result, "1.3.2", "review", "upper"));
  const order = (result.data?.readingOrder as { label: string }[]).map((stop) => stop.label);
  assert.ok(order.indexOf("下の文") < order.indexOf("上の文"));
  assert.ok(order.includes("設定 & プライバシー"));
  assert.equal((result.data?.unnamedImages as string[]).length, 1);
  assert.deepEqual(result.needsJudgment, ["1.1.1", "1.3.2"]);
});

test("Android: スクロールできる領域とフレームワークを注記し、読み上げ順の確かさを返す", async () => {
  const view = await checkAndroidScreen(fake("good.xml"));
  assert.deepEqual(view.data?.framework, { detected: ["Android View"], readingOrderConfidence: "higher" });
  assert.ok(!view.notes?.some((note) => /スクロール/.test(note)));

  const compose = await checkAndroidScreen(fake("compose.xml"));
  assert.deepEqual(compose.data?.framework, { detected: ["Jetpack Compose"], readingOrderConfidence: "lower" });
  assert.ok(compose.notes?.some((note) => /Jetpack Compose/.test(note)));
  assert.ok(compose.notes?.some((note) => /スクロールできる領域が 1 個/.test(note)));
  assert.equal((compose.data?.scrollableAreas as string[]).length, 1);
});

test("Android: 不備のない画面では指摘が出ない", async () => {
  const result = await checkAndroidScreen(fake("good.xml"));
  assert.deepEqual(result.summary, { fail: 0, review: 0 });
  assert.deepEqual(result.needsJudgment, ["1.3.2"]);
});

test("Android: 起動時のオプションで端末を選び、不正なシリアル番号は断る", () => {
  assert.equal(parseArgs([], {}).settings.serial, null);
  assert.equal(parseArgs(["--serial", "emulator-5554"], {}).settings.serial, "emulator-5554");
  assert.equal(parseArgs([], { KIKORI_ANDROID_SERIAL: "R58M000" }).settings.serial, "R58M000");
  assert.equal(parseArgs(["--lang=en"], { KIKORI_LANG: "ja" }).settings.lang, "en");
  assert.throws(() => parseArgs(["--android"], {}));
  assert.throws(() => adbDevice("x; rm -rf /"));
});

test("Android: adb の出力から階層と密度を取り出し、adb がないときは入れ方を伝える", async () => {
  // adb の代わりに、受け取った引数に応じて決まった出力を返すスクリプトを置く。
  const dir = mkdtempSync(path.join(tmpdir(), "kikori-adb-"));
  const xml = await fake("good.xml").hierarchy();
  writeFileSync(path.join(dir, "hierarchy.xml"), xml.trim());
  writeFileSync(
    path.join(dir, "adb"),
    `#!/bin/sh
[ "$1" = "-s" ] && shift 2
case "$*" in
  "exec-out uiautomator dump /dev/tty") cat "${dir}/hierarchy.xml"; echo "UI hierchary dumped to: /dev/tty" ;;
  "shell wm density") echo "Physical density: 420"; echo "Override density: 320" ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac
`,
  );
  chmodSync(path.join(dir, "adb"), 0o755);
  const original = process.env.PATH;
  try {
    process.env.PATH = `${dir}${path.delimiter}${original}`;
    const device = adbDevice("emulator-5554");
    assert.equal(await device.density(), 320);
    assert.ok((await device.hierarchy()).endsWith("</hierarchy>"));
    const result = await checkAndroidScreen(device);
    assert.deepEqual(result.summary, { fail: 0, review: 0 });

    process.env.PATH = mkdtempSync(path.join(tmpdir(), "kikori-empty-"));
    await assert.rejects(adbDevice(null).density(), /Platform-Tools/);
  } finally {
    process.env.PATH = original;
  }
});
