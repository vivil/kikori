import { lang } from "./i18n.js";

export type Level = "A" | "AA" | "AAA";

export interface SuccessCriterion {
  id: string;
  readonly name: string;
  level: Level;
  /** この達成基準が追加された WCAG のバージョン */
  since: "2.0" | "2.1" | "2.2";
}

/** name は、起動時に決めた言語に合わせて変わる。JSON にするときも、その時点の言語の名前が入る。 */
const row = (id: string, ja: string, en: string, level: Level, since: SuccessCriterion["since"] = "2.0"): SuccessCriterion => ({
  id,
  get name() {
    return lang() === "ja" ? ja : en;
  },
  level,
  since,
});

/** WCAG 2.1 の全達成基準。日本語の名称は WAIC の訳に、英語の名称は W3C の原文に合わせている。 */
export const WCAG21: readonly SuccessCriterion[] = [
  row("1.1.1", "非テキストコンテンツ", "Non-text Content", "A"),
  row("1.2.1", "音声のみ及び映像のみ (収録済)", "Audio-only and Video-only (Prerecorded)", "A"),
  row("1.2.2", "キャプション (収録済)", "Captions (Prerecorded)", "A"),
  row("1.2.3", "音声解説、又はメディアに対する代替 (収録済)", "Audio Description or Media Alternative (Prerecorded)", "A"),
  row("1.2.4", "キャプション (ライブ)", "Captions (Live)", "AA"),
  row("1.2.5", "音声解説 (収録済)", "Audio Description (Prerecorded)", "AA"),
  row("1.2.6", "手話 (収録済)", "Sign Language (Prerecorded)", "AAA"),
  row("1.2.7", "拡張音声解説 (収録済)", "Extended Audio Description (Prerecorded)", "AAA"),
  row("1.2.8", "メディアに対する代替 (収録済)", "Media Alternative (Prerecorded)", "AAA"),
  row("1.2.9", "音声のみ (ライブ)", "Audio-only (Live)", "AAA"),
  row("1.3.1", "情報及び関係性", "Info and Relationships", "A"),
  row("1.3.2", "意味のある順序", "Meaningful Sequence", "A"),
  row("1.3.3", "感覚的な特徴", "Sensory Characteristics", "A"),
  row("1.3.4", "表示の向き", "Orientation", "AA", "2.1"),
  row("1.3.5", "入力目的の特定", "Identify Input Purpose", "AA", "2.1"),
  row("1.3.6", "目的の特定", "Identify Purpose", "AAA", "2.1"),
  row("1.4.1", "色の使用", "Use of Color", "A"),
  row("1.4.2", "音声の制御", "Audio Control", "A"),
  row("1.4.3", "コントラスト (最低限)", "Contrast (Minimum)", "AA"),
  row("1.4.4", "テキストのサイズ変更", "Resize Text", "AA"),
  row("1.4.5", "文字画像", "Images of Text", "AA"),
  row("1.4.6", "コントラスト (高度)", "Contrast (Enhanced)", "AAA"),
  row("1.4.7", "小さな背景音、又は背景音なし", "Low or No Background Audio", "AAA"),
  row("1.4.8", "視覚的提示", "Visual Presentation", "AAA"),
  row("1.4.9", "文字画像 (例外なし)", "Images of Text (No Exception)", "AAA"),
  row("1.4.10", "リフロー", "Reflow", "AA", "2.1"),
  row("1.4.11", "非テキストのコントラスト", "Non-text Contrast", "AA", "2.1"),
  row("1.4.12", "テキストの間隔", "Text Spacing", "AA", "2.1"),
  row("1.4.13", "ホバー又はフォーカスで表示されるコンテンツ", "Content on Hover or Focus", "AA", "2.1"),
  row("2.1.1", "キーボード", "Keyboard", "A"),
  row("2.1.2", "キーボードトラップなし", "No Keyboard Trap", "A"),
  row("2.1.3", "キーボード (例外なし)", "Keyboard (No Exception)", "AAA"),
  row("2.1.4", "文字キーのショートカット", "Character Key Shortcuts", "A", "2.1"),
  row("2.2.1", "タイミング調整可能", "Timing Adjustable", "A"),
  row("2.2.2", "一時停止、停止、非表示", "Pause, Stop, Hide", "A"),
  row("2.2.3", "タイミング非依存", "No Timing", "AAA"),
  row("2.2.4", "割り込み", "Interruptions", "AAA"),
  row("2.2.5", "再認証", "Re-authenticating", "AAA"),
  row("2.2.6", "タイムアウト", "Timeouts", "AAA", "2.1"),
  row("2.3.1", "3 回の閃光、又は閾値以下", "Three Flashes or Below Threshold", "A"),
  row("2.3.2", "3 回の閃光", "Three Flashes", "AAA"),
  row("2.3.3", "インタラクションによるアニメーション", "Animation from Interactions", "AAA", "2.1"),
  row("2.4.1", "ブロックスキップ", "Bypass Blocks", "A"),
  row("2.4.2", "ページタイトル", "Page Titled", "A"),
  row("2.4.3", "フォーカス順序", "Focus Order", "A"),
  row("2.4.4", "リンクの目的 (コンテキスト内)", "Link Purpose (In Context)", "A"),
  row("2.4.5", "複数の手段", "Multiple Ways", "AA"),
  row("2.4.6", "見出し及びラベル", "Headings and Labels", "AA"),
  row("2.4.7", "フォーカスの可視化", "Focus Visible", "AA"),
  row("2.4.8", "現在位置", "Location", "AAA"),
  row("2.4.9", "リンクの目的 (リンクのみ)", "Link Purpose (Link Only)", "AAA"),
  row("2.4.10", "セクション見出し", "Section Headings", "AAA"),
  row("2.5.1", "ポインタのジェスチャ", "Pointer Gestures", "A", "2.1"),
  row("2.5.2", "ポインタのキャンセル", "Pointer Cancellation", "A", "2.1"),
  row("2.5.3", "ラベルを含む名前 (name)", "Label in Name", "A", "2.1"),
  row("2.5.4", "動きによる起動", "Motion Actuation", "A", "2.1"),
  row("2.5.5", "ターゲットのサイズ", "Target Size", "AAA", "2.1"),
  row("2.5.6", "入力メカニズム非依存", "Concurrent Input Mechanisms", "AAA", "2.1"),
  row("3.1.1", "ページの言語", "Language of Page", "A"),
  row("3.1.2", "一部分の言語", "Language of Parts", "AA"),
  row("3.1.3", "一般的ではない用語", "Unusual Words", "AAA"),
  row("3.1.4", "略語", "Abbreviations", "AAA"),
  row("3.1.5", "読解レベル", "Reading Level", "AAA"),
  row("3.1.6", "発音", "Pronunciation", "AAA"),
  row("3.2.1", "フォーカス時", "On Focus", "A"),
  row("3.2.2", "入力時", "On Input", "A"),
  row("3.2.3", "一貫したナビゲーション", "Consistent Navigation", "AA"),
  row("3.2.4", "一貫した識別性", "Consistent Identification", "AA"),
  row("3.2.5", "要求による変化", "Change on Request", "AAA"),
  row("3.3.1", "エラーの特定", "Error Identification", "A"),
  row("3.3.2", "ラベル又は説明", "Labels or Instructions", "A"),
  row("3.3.3", "エラー修正の提案", "Error Suggestion", "AA"),
  row("3.3.4", "エラー回避 (法的、金融、データ)", "Error Prevention (Legal, Financial, Data)", "AA"),
  row("3.3.5", "ヘルプ", "Help", "AAA"),
  row("3.3.6", "エラー回避 (すべて)", "Error Prevention (All)", "AAA"),
  row("4.1.1", "構文解析", "Parsing", "A"),
  row("4.1.2", "名前 (name)・役割 (role)・値 (value)", "Name, Role, Value", "A"),
  row("4.1.3", "ステータスメッセージ", "Status Messages", "AA", "2.1"),
];

/** WCAG 2.2 で追加された達成基準のうち、このツールが検査するもの。 */
export const WCAG22_EXTRA: readonly SuccessCriterion[] = [row("2.4.11", "隠されないフォーカス (最低限)", "Focus Not Obscured (Minimum)", "AA", "2.2")];

const BY_ID = new Map([...WCAG21, ...WCAG22_EXTRA].map((c) => [c.id, c]));

export function criterion(id: string): SuccessCriterion {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown success criterion: ${id}`);
  return found;
}

export function findCriterion(id: string): SuccessCriterion | undefined {
  return BY_ID.get(id);
}

const RANK: Record<Level, number> = { A: 1, AA: 2, AAA: 3 };

/** 達成基準が、目標とする適合レベルの範囲に入るか */
export function withinLevel(sc: SuccessCriterion, target: Level): boolean {
  return RANK[sc.level] <= RANK[target];
}
