export type Lang = "ja" | "en";

/** 指定がなければ、利用者の環境の言語設定に合わせる。日本語でなければ英語にする。 */
export function detectLang(env: NodeJS.ProcessEnv): Lang {
  const explicit = env.KIKORI_LANG?.toLowerCase();
  if (explicit === "ja" || explicit === "en") return explicit;
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  return locale.toLowerCase().startsWith("ja") ? "ja" : "en";
}

let current: Lang = detectLang(process.env);

export function lang(): Lang {
  return current;
}

/** 文面に使う言語を決める。各パッケージが、起動時の設定を読んだあとに呼ぶ。 */
export function setLang(next: Lang): void {
  current = next;
}

/** 起動時に決めた言語に合わせて、文面を選ぶ。 */
export function tr(ja: string, en: string): string {
  return current === "ja" ? ja : en;
}
