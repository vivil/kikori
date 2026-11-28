import { detectLang, setLang, type Lang } from "../../core/src/i18n.js";

/** サーバーの起動時に決める設定。どの端末を検査するかは人が決めるもので、ツールの引数からは変えられない。 */
export interface Settings {
  lang: Lang;
  /** adb に渡す端末のシリアル番号。null のときは、つながっている唯一の端末を使う。 */
  serial: string | null;
}

function fromEnvironment(env: NodeJS.ProcessEnv): Settings {
  return { lang: detectLang(env), serial: env.KIKORI_ANDROID_SERIAL || null };
}

let current: Settings = fromEnvironment(process.env);

export function getSettings(): Settings {
  return current;
}

export function configure(settings: Settings): void {
  current = settings;
  setLang(settings.lang);
}

const USAGE_JA = `使い方: kikori-mobile [オプション]

  --lang <ja|en>     検査結果やエラーの文面に使う言語。
                     指定しないときは、環境の言語設定が日本語なら ja、それ以外は en。
  --serial <番号>    検査する Android の端末のシリアル番号 (adb devices で確認できる)。
                     指定しないときは、つながっている唯一の端末を使う。
  --help             この説明を表示する。

環境変数 KIKORI_LANG、KIKORI_ANDROID_SERIAL でも指定できる。オプションと環境変数の両方があるときは、オプションを使う。
Android の検査には、Android SDK の Platform-Tools に含まれる adb が必要。`;

const USAGE_EN = `Usage: kikori-mobile [options]

  --lang <ja|en>     Language for results and errors.
                     Defaults to ja when the system locale is Japanese, otherwise en.
  --serial <id>      Serial of the Android device to check (see adb devices).
                     When omitted, the only connected device is used.
  --help             Show this help.

The same settings can be given with the environment variables KIKORI_LANG and KIKORI_ANDROID_SERIAL.
Options take precedence.
The Android checks need adb from the Android SDK Platform-Tools.`;

export function usage(language: Lang): string {
  return language === "ja" ? USAGE_JA : USAGE_EN;
}

/** 起動時の引数を読む。環境変数の設定を、引数で上書きする。 */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): { settings: Settings; help: boolean } {
  const settings = fromEnvironment(env);
  const say = (ja: string, en: string): string => (settings.lang === "ja" ? ja : en);
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [name, inline] = arg.includes("=") ? (arg.split(/=(.*)/s, 2) as [string, string]) : [arg, undefined];
    const value = (): string => {
      const next = inline ?? argv[++i];
      if (next === undefined || next === "") throw new Error(say(`${name} には値が必要です。`, `${name} requires a value.`));
      return next;
    };
    switch (name) {
      case "--lang": {
        const chosen = value().toLowerCase();
        if (chosen !== "ja" && chosen !== "en") throw new Error(say("--lang には ja か en を指定してください。", "--lang must be ja or en."));
        settings.lang = chosen;
        break;
      }
      case "--serial":
        settings.serial = value();
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(say(`知らないオプションです: ${arg}`, `Unknown option: ${arg}`));
    }
  }
  return { settings, help };
}
