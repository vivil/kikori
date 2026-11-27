import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/**
 * 検査に使うブラウザを入れる。kikori が依存している Playwright 自身に入れさせるので、
 * 利用者が別の版の Playwright で入れてしまい、ブラウザの版が合わなくなることがない。
 * 追加の引数 (--with-deps、--dry-run など) は、そのまま Playwright に渡す。
 */
export function installBrowser(extraArgs: string[]): number {
  const cli = path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");
  const result = spawnSync(process.execPath, [cli, "install", "chromium-headless-shell", ...extraArgs], { stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

/** package.json に書かれた、このパッケージのバージョン。 */
export function packageVersion(): string {
  return (require("../../package.json") as { version: string }).version;
}
