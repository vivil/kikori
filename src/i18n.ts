import { getSettings } from "./config.js";

export type Lang = "ja" | "en";

export function lang(): Lang {
  return getSettings().lang;
}

/** 起動時に決めた言語に合わせて、文面を選ぶ。 */
export function tr(ja: string, en: string): string {
  return lang() === "ja" ? ja : en;
}
