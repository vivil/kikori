import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/**
 * 検査に使うブラウザを入れる。kikori が依存している Playwright 自身に入れさせるので、
 * 利用者が別の版の Playwright で入れてしまい、ブラウザの版が合わなくなることがない。
 * 追加の引数 (--with-deps、--dry-run など) は、そのまま Playwright に渡す。
 */
export function installBrowser(extraArgs: string[]): number {
  const result = spawnSync(process.execPath, [playwrightCli(), "install", "chromium-headless-shell", ...extraArgs], { stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function playwrightCli(): string {
  return path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");
}

/**
 * サーバーの動作中にブラウザを入れる。標準出力は MCP の通信に使っているので、
 * 進み具合はすべて標準エラーに流す。待っている間も、ほかの通信に応答できるよう同期では実行しない。
 */
function downloadBrowser(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [playwrightCli(), "install", "chromium-headless-shell"], { stdio: ["ignore", 2, 2] });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`playwright install exited with code ${code}`))));
  });
}

let pending: Promise<void> | undefined;

export function isMissingBrowser(error: unknown): boolean {
  return error instanceof Error && /Executable doesn't exist/.test(error.message);
}

/**
 * ブラウザを起動する。本体がまだなければ、1 度だけ取得してから起動し直す。
 * 同時に複数の検査が始まっても、取得は 1 回にまとめる。
 * 取得できなかったとき、または autoInstall が false のときは、MissingBrowserError を投げる。
 */
export async function launchWithInstall<T>(launch: () => Promise<T>, autoInstall: boolean, download: () => Promise<void> = downloadBrowser): Promise<T> {
  try {
    return await launch();
  } catch (error) {
    if (!isMissingBrowser(error)) throw error;
    if (!autoInstall) throw new MissingBrowserError();
    if (!pending) {
      console.error("[kikori] The browser used for the checks is not installed. Downloading it now (first run only, about 300 MB on disk)...");
      pending = download().finally(() => {
        pending = undefined;
      });
    }
    try {
      await pending;
    } catch (cause) {
      throw new MissingBrowserError(cause instanceof Error ? cause.message : String(cause));
    }
    return launch();
  }
}

export class MissingBrowserError extends Error {
  /** 自動での取得を試みて失敗したときの、失敗の内容 */
  readonly downloadFailure: string | undefined;
  constructor(downloadFailure?: string) {
    super("browser is not installed");
    this.downloadFailure = downloadFailure;
  }
}

/** package.json に書かれた、このパッケージのバージョン。 */
export function packageVersion(): string {
  return (require("../../package.json") as { version: string }).version;
}
