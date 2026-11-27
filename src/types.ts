import { criterion, type SuccessCriterion } from "./criteria.js";

export type { SuccessCriterion };

/** 検査結果の重み。fail は機械的に確認できた不適合、review は人の目での確認が必要なもの。 */
export type Severity = "fail" | "review";

export const SC = {
  nonTextContent: criterion("1.1.1"),
  meaningfulSequence: criterion("1.3.2"),
  sensoryCharacteristics: criterion("1.3.3"),
  inputPurpose: criterion("1.3.5"),
  audioControl: criterion("1.4.2"),
  imagesOfText: criterion("1.4.5"),
  visualPresentation: criterion("1.4.8"),
  reflow: criterion("1.4.10"),
  nonTextContrast: criterion("1.4.11"),
  textSpacing: criterion("1.4.12"),
  hoverContent: criterion("1.4.13"),
  keyboard: criterion("2.1.1"),
  noKeyboardTrap: criterion("2.1.2"),
  characterKeyShortcuts: criterion("2.1.4"),
  pauseStopHide: criterion("2.2.2"),
  threeFlashes: criterion("2.3.1"),
  pageTitled: criterion("2.4.2"),
  focusOrder: criterion("2.4.3"),
  linkPurpose: criterion("2.4.4"),
  multipleWays: criterion("2.4.5"),
  headingsAndLabels: criterion("2.4.6"),
  focusVisible: criterion("2.4.7"),
  location: criterion("2.4.8"),
  focusNotObscured: criterion("2.4.11"),
  focusNotObscuredEnhanced: criterion("2.4.12"),
  focusAppearance: criterion("2.4.13"),
  pointerGestures: criterion("2.5.1"),
  pointerCancellation: criterion("2.5.2"),
  motionActuation: criterion("2.5.4"),
  targetSize: criterion("2.5.5"),
  dragging: criterion("2.5.7"),
  targetSizeMinimum: criterion("2.5.8"),
  onFocus: criterion("3.2.1"),
  onInput: criterion("3.2.2"),
  consistentNavigation: criterion("3.2.3"),
  consistentIdentification: criterion("3.2.4"),
  consistentHelp: criterion("3.2.6"),
  redundantEntry: criterion("3.3.7"),
  accessibleAuthentication: criterion("3.3.8"),
  accessibleAuthenticationEnhanced: criterion("3.3.9"),
  statusMessages: criterion("4.1.3"),
} as const;

export interface Finding {
  sc: SuccessCriterion;
  severity: Severity;
  /** 対象要素を指す CSS セレクタ */
  selector: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface CheckResult {
  check: string;
  url: string;
  viewport: { width: number; height: number };
  summary: { fail: number; review: number };
  findings: Finding[];
  /** この検査が調べた達成基準の番号。指摘がなければ「自動検査の範囲で問題なし」と読める。 */
  checked: string[];
  /** 対象になる要素がページになく、該当しないと推定した達成基準の番号 */
  inapplicable?: string[];
  /** 機械的には結論を出せず、呼び出し側のモデルか人の判断が要る達成基準の番号 */
  needsJudgment?: string[];
  /** 判断材料として返す補足データ (フォーカス順の一覧など) */
  data?: Record<string, unknown>;
  notes?: string[];
}

export function summarize(findings: Finding[]): { fail: number; review: number } {
  return {
    fail: findings.filter((f) => f.severity === "fail").length,
    review: findings.filter((f) => f.severity === "review").length,
  };
}
