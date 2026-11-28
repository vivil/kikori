import { execFile } from "node:child_process";
import { tr } from "../../../core/src/i18n.js";

/** 検査に必要な、端末への問い合わせ。テストでは、端末なしで動く実装に差し替える。 */
export interface Device {
  /** UI Automator が書き出す、いまの画面の階層 (XML) */
  hierarchy(): Promise<string>;
  /** 画面の密度 (dpi)。160 のとき、1dp が 1px になる。 */
  density(): Promise<number>;
  /** PNG のスクリーンショット */
  screenshot(): Promise<Buffer>;
}

const SERIAL = /^[A-Za-z0-9._:-]{1,64}$/;

/** adb を通して、エミュレーターか実機に問い合わせる。読み取りだけを行い、端末の設定は変えない。 */
export function adbDevice(serial: string | null): Device {
  if (serial !== null && !SERIAL.test(serial)) {
    throw new Error(tr(`端末のシリアル番号として解釈できません: ${serial}`, `Not a valid device serial: ${serial}`));
  }
  const run = (args: string[], encoding: "utf8" | "buffer"): Promise<string | Buffer> =>
    new Promise((resolve, reject) => {
      // シェルを通さずに実行する。引数は、ここで組み立てた固定のものだけ。
      execFile("adb", [...(serial ? ["-s", serial] : []), ...args], { encoding, maxBuffer: 64 * 1024 * 1024, timeout: 30_000 }, (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return reject(new Error(tr("adb が見つかりません。Android SDK の Platform-Tools を入れ、adb に PATH を通してください。", "adb was not found. Install the Android SDK Platform-Tools and put adb on the PATH.")));
        }
        const detail = String(stderr).trim().split("\n")[0] ?? "";
        reject(new Error(tr(`adb が失敗しました: ${detail || error.message}`, `adb failed: ${detail || error.message}`)));
      });
    });
  return {
    async hierarchy() {
      const out = String(await run(["exec-out", "uiautomator", "dump", "/dev/tty"], "utf8"));
      const end = out.lastIndexOf("</hierarchy>");
      const start = out.indexOf("<?xml");
      if (end < 0) {
        throw new Error(tr("画面の階層を取得できませんでした。端末の画面が点灯していて、アプリが表示されているか確かめてください。", "Could not read the screen hierarchy. Check that the device screen is on and an app is showing."));
      }
      return out.slice(start < 0 ? out.indexOf("<hierarchy") : start, end + "</hierarchy>".length);
    },
    async density() {
      const out = String(await run(["shell", "wm", "density"], "utf8"));
      // 上書きした値があれば、実際に使われているのはそちら。
      const match = /Override density:\s*(\d+)/.exec(out) ?? /Physical density:\s*(\d+)/.exec(out);
      if (!match) throw new Error(tr("画面の密度を取得できませんでした。", "Could not read the screen density."));
      return Number(match[1]);
    },
    async screenshot() {
      return (await run(["exec-out", "screencap", "-p"], "buffer")) as Buffer;
    },
  };
}
