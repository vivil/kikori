import { tr } from "../../packages/core/src/i18n.js";
import type { Page } from "playwright";
import { withPage } from "../browser.js";
import { changedOutsideMotion, decodePng } from "../pixels.js";
import { SC, summarize, type CheckResult, type Finding } from "../../packages/core/src/types.js";
import type { ElementInfo } from "../helpers.js";
import { collectListeners } from "../listeners.js";

export interface FocusOptions {
  url: string;
  width?: number;
  height?: number;
  /** Tab キーを押す回数の上限 */
  maxSteps?: number;
  waitForSelector?: string;
  waitMs?: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type FocusState =
  | { kind: "none" }
  | {
      kind: "element";
      /** ページ内で記憶している要素の番号。同じ要素なら同じ番号になる。 */
      index: number;
      revisit: boolean;
      info: ElementInfo;
      isFrame: boolean;
      /** 文字入力ができる要素か。キャレットがフォーカスの手がかりになりうる。 */
      editable: boolean;
      /** 要素自体が極小または透明で、見た目は別の要素が担っている */
      visuallyHidden: boolean;
      /** fixed / sticky の中にあり、文書上の位置を比べられない */
      pinned: boolean;
      tabindex: string | null;
      docTop: number;
      docBottom: number;
      /** フォーカス表示を撮影する範囲。画面内に入っていなければ null。 */
      clip: Box | null;
      obscured: "none" | "partial" | "full";
      obscuredBy: string | null;
      outline: string;
    };

interface StaticReport {
  positiveTabindex: ElementInfo[];
  unreachableRoles: ElementInfo[];
  clickOnly: ElementInfo[];
}

interface SequenceEntry {
  step: number;
  selector: string;
  tag: string;
  role: string | null;
  text: string;
}

const MAX_REPORTED = 20;
const MAX_FRAME_STEPS = 50;

export async function checkKeyboardFocus(options: FocusOptions): Promise<CheckResult> {
  const viewport = { width: options.width ?? 1280, height: options.height ?? 720 };
  const maxSteps = options.maxSteps ?? 150;

  return withPage({ ...options, viewport }, async (page) => {
    const findings: Finding[] = [];
    const notes: string[] = [];
    const sequence: SequenceEntry[] = [];
    let previous: Extract<FocusState, { kind: "element" }> | undefined;
    let frameSteps = 0;
    // スクリプト、動画、GIF などで動き続ける部分があると、フォーカスの有無と関係なく画面が変わる。
    // そうしたページかどうかを、先に 2 枚撮り比べて確かめておく。
    const still = { animations: "disabled", caret: "hide" } as const;
    const before = await page.screenshot(still);
    await page.waitForTimeout(250);
    const ambientMotion = !before.equals(await page.screenshot(still));
    let completed = false;
    let backwardJumps = 0;
    let contextChanged = false;
    let popups = 0;
    page.on("popup", () => popups++);
    const startUrl = withoutHash(page.url());

    for (let step = 1; step <= maxSteps; step++) {
      await page.keyboard.press("Tab");
      // フォーカスを受け取っただけでページが移動したり、新しいウィンドウが開いたりしないかを見る。
      await page.waitForTimeout(30);
      if (withoutHash(page.url()) !== startUrl || popups > 0) {
        contextChanged = true;
        findings.push({
          sc: SC.onFocus,
          severity: "fail",
          selector: previous?.info.selector ?? "html",
          message: tr(`${previous ? `${previous.info.selector} の次の要素` : "最初の要素"}にフォーカスを移しただけで、${popups > 0 ? "新しいウィンドウが開きました" : `ページが ${page.url()} へ移動しました`}。フォーカスだけでは状況を変えず、利用者の操作を待ってください。`, `Merely moving focus to ${previous ? `the element after ${previous.info.selector}` : "the first element"} ${popups > 0 ? "opened a new window" : `moved the page to ${page.url()}`}. Focus alone must not change the context; wait for the user to act.`),
          details: { tabCount: step, movedTo: page.url() },
        });
        break;
      }
      const state = await page.evaluate(inspectFocus);

      if (state.kind === "none") {
        // フォーカスが文書の先頭に戻った。一巡したとみなす。
        completed = true;
        break;
      }
      if (state.isFrame && previous?.index === state.index) {
        // iframe の中を移動している間は、外側からは同じ要素に見える。
        if (++frameSteps > MAX_FRAME_STEPS) {
          notes.push(tr(`${state.info.selector} の中で ${MAX_FRAME_STEPS} 回 Tab を押しても外に出なかったため、検査を打ち切りました。`, `Pressing Tab ${MAX_FRAME_STEPS} times inside ${state.info.selector} did not leave it, so the check was stopped.`));
          break;
        }
        continue;
      }
      frameSteps = 0;

      if (previous && previous.index === state.index) {
        // Tab を押しても、同じ要素にフォーカスが戻ってくる。
        findings.push({
          sc: SC.noKeyboardTrap,
          severity: "review",
          selector: state.info.selector,
          message: tr(
            "Tab キーを押しても、フォーカスがこの要素から動きません。別のキーで抜けられるか、その方法が利用者に伝わっているか確認してください。",
            "Pressing Tab does not move focus away from this element. Check that another key lets users leave, and that they are told how.",
          ),
          details: { loop: [state.info.selector] },
        });
        break;
      }

      if (state.revisit) {
        if (sequence[0]?.selector === state.info.selector) {
          completed = true;
        } else {
          const loopStart = sequence.findIndex((s) => s.selector === state.info.selector);
          const loop = sequence.slice(loopStart).map((s) => s.selector);
          findings.push({
            sc: SC.noKeyboardTrap,
            severity: "review",
            selector: state.info.selector,
            message: tr(`Tab キーでフォーカスが ${loop.length} 個の要素の間を巡り、ページの残りへ進めません。モーダルダイアログのように意図した挙動であれば、Esc キーなどで抜けられるか確認してください。`, `Tab cycles focus among ${loop.length} elements and cannot reach the rest of the page. If this is intended, as in a modal dialog, check that Esc or another key leaves it.`),
            details: { loop },
          });
        }
        break;
      }

      sequence.push({ step: sequence.length + 1, selector: state.info.selector, tag: state.info.tag, role: state.info.role, text: state.info.text });

      if (state.isFrame) {
        notes.push(tr(`${state.info.selector} は iframe です。中の要素は順序の一覧に含めておらず、フォーカス表示も検査していません。`, `${state.info.selector} is an iframe. Elements inside it are not listed in the sequence and their focus indicators were not checked.`));
      } else {
        findings.push(...(await inspectIndicator(page, state, ambientMotion)));
      }

      if (previous && !previous.pinned && !state.pinned && !previous.visuallyHidden && !state.visuallyHidden) {
        if (state.docBottom <= previous.docTop - 8 && backwardJumps++ < MAX_REPORTED) {
          findings.push({
            sc: SC.focusOrder,
            severity: "review",
            selector: state.info.selector,
            message: tr(`フォーカスが見た目の上で前の要素 (${previous.info.selector}) より上に戻ります。意味の通る順序になっているか確認してください。`, `Focus jumps visually back above the previous element (${previous.info.selector}). Check that the order makes sense.`),
            details: { previous: previous.info.selector, text: state.info.text },
          });
        }
      }
      previous = state;
    }

    if (!completed && sequence.length >= maxSteps) {
      notes.push(tr(`Tab キーを ${maxSteps} 回押してもフォーカスが一巡しなかったため、途中で打ち切りました。maxSteps を増やすと続きを検査できます。`, `Focus did not complete a cycle within ${maxSteps} Tab presses, so the check was cut short. Raise maxSteps to continue.`));
    }
    if (sequence.length === 0) {
      notes.push(tr("Tab キーでフォーカスできる要素が見つかりませんでした。", "No element could be focused with the Tab key."));
    }

    if (contextChanged) {
      // 移動した先のページでは検査を続けられない。
      notes.push(tr("フォーカスによってページの状況が変わったため、以降の検査を打ち切りました。", "Focus changed the context of the page, so the rest of the check was skipped."));
      return {
        check: "keyboard_focus",
        url: options.url,
        viewport,
        summary: summarize(findings),
        findings,
        checked: ["3.2.1"],
        data: { completedCycle: false, focusableCount: sequence.length, sequence },
        notes,
      };
    }

    // addEventListener やフレームワーク経由で付けたクリックの処理も、onclick 属性と同じように扱う。
    const clicks = await collectListeners(page, ["click"]).catch(() => null);
    if (!clicks) notes.push(tr("イベントリスナーを取得できなかったため、クリックの処理は onclick 属性だけを調べました。", "Event listeners could not be read, so click handlers were checked through the onclick attribute only."));
    const report = await page.evaluate(collectStatic, [...new Set((clicks?.listeners ?? []).map((l) => l.selector))]);
    for (const info of report.positiveTabindex.slice(0, MAX_REPORTED)) {
      findings.push({
        sc: SC.focusOrder,
        severity: "review",
        selector: info.selector,
        message: tr("tabindex に 1 以上の値が指定されています。文書の順序より先にフォーカスが移るため、意図した順序か確認してください。", "tabindex has a value of 1 or more. Focus reaches it before document order; check that this order is intended."),
        details: { text: info.text },
      });
    }
    for (const info of report.unreachableRoles.slice(0, MAX_REPORTED)) {
      findings.push({
        sc: SC.keyboard,
        severity: "fail",
        selector: info.selector,
        message: tr(`role="${info.role}" が付いていますが、Tab キーでフォーカスできません。ネイティブの要素に置き換えるか、tabindex="0" とキー操作を追加してください。`, `Has role="${info.role}" but cannot be focused with the Tab key. Use a native element, or add tabindex="0" and key handling.`),
        details: { text: info.text },
      });
    }
    for (const info of report.clickOnly.slice(0, MAX_REPORTED)) {
      findings.push({
        sc: SC.keyboard,
        severity: "review",
        selector: info.selector,
        message: tr("クリックの処理が付いていますが、キーボードでフォーカスできない要素です。同じ操作をキーボードでも行えるか確認してください。", "Has a click handler but cannot be focused with the keyboard. Check that the same action is available from the keyboard."),
        details: { text: info.text },
      });
    }

    return {
      check: "keyboard_focus",
      url: options.url,
      viewport,
      summary: summarize(findings),
      findings,
      checked: ["2.1.1", "2.1.2", "2.4.3", "2.4.7", "2.4.11", "2.4.12", "2.4.13", "3.2.1"],
      data: { completedCycle: completed, focusableCount: sequence.length, sequence },
      ...(notes.length > 0 ? { notes } : {}),
    };
  });
}

function withoutHash(url: string): string {
  const hash = url.indexOf("#");
  return hash === -1 ? url : url.slice(0, hash);
}

/** フォーカス中の要素について、表示の有無と隠れ具合を調べる。 */
async function inspectIndicator(page: Page, state: Extract<FocusState, { kind: "element" }>, ambientMotion: boolean): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { info } = state;

  if (!state.clip) {
    findings.push({
      sc: SC.focusVisible,
      severity: "fail",
      selector: info.selector,
      message: tr("フォーカスを受け取りますが、要素が画面の外にあるか大きさを持たないため、どこにフォーカスがあるのか見えません。", "Receives focus, but it is off-screen or has no size, so the focus location cannot be seen."),
      details: { text: info.text },
    });
    return findings;
  }

  const shot = { clip: state.clip, animations: "disabled", caret: "hide" } as const;
  const focused = await page.screenshot(shot);
  await page.evaluate((index) => window.__kikoriFocus.blur(index), state.index);
  const blurred = await page.screenshot(shot);
  // 動き続ける部分があるページでは、フォーカスを外したままもう 1 枚撮り、その動きを差し引いて比べる。
  let indicatorShown = !focused.equals(blurred);
  let unsettled = false;
  if (indicatorShown && ambientMotion) {
    const again = await page.screenshot(shot);
    if (!again.equals(blurred)) {
      indicatorShown = changedOutsideMotion(decodePng(focused), decodePng(blurred), [decodePng(blurred), decodePng(again)]);
      unsettled = !indicatorShown;
    }
  }
  await page.evaluate((index) => window.__kikoriFocus.refocus(index), state.index);

  if (unsettled && state.obscured !== "full") {
    findings.push({
      sc: SC.focusVisible,
      severity: "review",
      selector: info.selector,
      message: tr(
        "この要素の表示が動き続けているため、フォーカス表示があるかどうかを画像から判断できませんでした。フォーカスしたときに見た目が変わるか、確認してください。",
        "This element keeps changing on screen, so the screenshots could not show whether it has a focus indicator. Check that its appearance changes on focus.",
      ),
      details: { text: info.text, outline: state.outline },
    });
  }

  // 全体が隠れている要素は、表示の有無を見分けられないので 2.4.11 だけを報告する。
  if (state.obscured !== "full" && focused.equals(blurred)) {
    findings.push(
      state.editable
        ? {
            sc: SC.focusVisible,
            severity: "review",
            selector: info.selector,
            message: tr("フォーカスしても、キャレット以外に見た目の変化がありません。キャレットだけで十分に見分けられるか確認してください。", "Nothing changes on focus other than the caret. Check that the caret alone is enough to tell where focus is."),
            details: { text: info.text, outline: state.outline },
          }
        : {
            sc: SC.focusVisible,
            severity: "fail",
            selector: info.selector,
            message: tr("フォーカスしても見た目が変わりません。outline などでフォーカス表示を付けてください。", "Nothing changes visually on focus. Add a focus indicator, for example with outline."),
            details: { text: info.text, outline: state.outline },
          },
    );
  }

  if (state.obscured === "full") {
    findings.push({
      sc: SC.focusNotObscured,
      severity: "fail",
      selector: info.selector,
      message: tr(`フォーカス中の要素が、別の要素 (${state.obscuredBy ?? "不明"}) に全体が隠れています。固定ヘッダーなどの裏に入らないよう、scroll-padding などで調整してください。`, `The focused element is entirely hidden behind another element (${state.obscuredBy ?? "unknown"}). Adjust with scroll-padding or similar so it does not go under a fixed header.`),
      details: { text: info.text, obscuredBy: state.obscuredBy },
    });
  } else if (state.obscured === "partial") {
    // 一部が隠れているだけなら 2.4.11 (AA) は満たす。どこも隠れないことを求めるのは 2.4.12 (AAA)。
    findings.push({
      sc: SC.focusNotObscuredEnhanced,
      severity: "fail",
      selector: info.selector,
      message: tr(
        `フォーカス中の要素の一部が、別の要素 (${state.obscuredBy ?? "不明"}) に隠れています。固定ヘッダーなどの裏に入らないよう、scroll-padding などで調整してください。`,
        `Part of the focused element is hidden behind another element (${state.obscuredBy ?? "unknown"}). Adjust with scroll-padding or similar so it does not go under a fixed header.`,
      ),
      details: { text: info.text, obscuredBy: state.obscuredBy },
    });
  }

  // 2.4.13 (AAA): フォーカス表示は、太さ 2px の外周に相当する面積と、3:1 以上の変化が要る。
  // 画像からは測っていないので、outline の指定が基準に届かないときだけ、確認を求める。
  if (indicatorShown && state.obscured !== "full") {
    const [style, width] = state.outline.split(" ");
    if (style === "none" || parseFloat(width ?? "0") < 2) {
      findings.push({
        sc: SC.focusAppearance,
        severity: "review",
        selector: info.selector,
        message: tr(
          `フォーカス表示はありますが、outline は ${style === "none" ? "指定されていません" : `${width} です`}。太さ 2px の外周に相当する面積があり、フォーカスの有無で 3:1 以上の差が出ているか確認してください。`,
          `There is a focus indicator, but the outline is ${style === "none" ? "not set" : width}. Check that the indicator is at least as large as a 2px perimeter and changes contrast by at least 3:1 between the focused and unfocused states.`,
        ),
        details: { text: info.text, outline: state.outline },
      });
    }
  }
  return findings;
}

declare global {
  interface Window {
    __kikoriFocus: {
      seen: Element[];
      blur(index: number): void;
      refocus(index: number): void;
    };
  }
}

/** ブラウザ側で実行する。外側の変数は参照できない。 */
function inspectFocus(): FocusState {
  const kikori = window.__kikori;
  window.__kikoriFocus ??= {
    seen: [],
    blur(index) {
      (this.seen[index] as HTMLElement | undefined)?.blur();
    },
    refocus(index) {
      (this.seen[index] as HTMLElement | undefined)?.focus({ preventScroll: true });
    },
  };
  const store = window.__kikoriFocus;

  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (!active || active === document.body || active === document.documentElement) return { kind: "none" };
  const el = active as HTMLElement;

  let index = store.seen.indexOf(el);
  const revisit = index !== -1;
  if (!revisit) index = store.seen.push(el) - 1;

  const style = getComputedStyle(el);
  let rect = el.getBoundingClientRect();
  const visuallyHidden = rect.width < 4 || rect.height < 4 || Number(style.opacity) === 0;
  if (visuallyHidden) {
    // 見た目を担っている要素 (ラベルや親) の範囲で、フォーカス表示の有無を確かめる。
    const proxy = (el as HTMLInputElement).labels?.[0] ?? el.closest("label") ?? el.parentElement;
    if (proxy) rect = proxy.getBoundingClientRect();
  }

  let pinned = false;
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const position = getComputedStyle(cur).position;
    if (position === "fixed" || position === "sticky") {
      pinned = true;
      break;
    }
  }

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const margin = 6;
  const left = Math.max(0, Math.floor(rect.left - margin));
  const top = Math.max(0, Math.floor(rect.top - margin));
  const right = Math.min(vw, Math.ceil(rect.right + margin));
  const bottom = Math.min(vh, Math.ceil(rect.bottom + margin));
  const inViewport = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < vw && rect.top < vh;
  const clip = inViewport && right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;

  let obscured: "none" | "partial" | "full" = "none";
  let obscuredBy: string | null = null;
  if (clip && !visuallyHidden) {
    const root = el.getRootNode();
    const host = root instanceof ShadowRoot ? root.host : null;
    let covered = 0;
    let total = 0;
    for (const fx of [0.1, 0.5, 0.9]) {
      for (const fy of [0.1, 0.5, 0.9]) {
        const x = rect.left + rect.width * fx;
        const y = rect.top + rect.height * fy;
        total++;
        if (x < 0 || y < 0 || x >= vw || y >= vh) {
          covered++;
          continue;
        }
        const hit = document.elementFromPoint(x, y);
        if (!hit || hit === el || el.contains(hit) || hit.contains(el) || (host && (hit === host || hit.contains(host)))) continue;
        covered++;
        obscuredBy ??= kikori.selector(hit);
      }
    }
    if (covered === total) obscured = obscuredBy ? "full" : "none";
    else if (covered > 0 && obscuredBy) obscured = "partial";
  }

  const editable =
    el.isContentEditable ||
    el.tagName === "TEXTAREA" ||
    (el.tagName === "INPUT" && !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"].includes((el as HTMLInputElement).type));

  return {
    kind: "element",
    index,
    revisit,
    info: kikori.describe(el),
    isFrame: el.tagName === "IFRAME" || el.tagName === "FRAME",
    editable,
    visuallyHidden,
    pinned,
    tabindex: el.getAttribute("tabindex"),
    docTop: rect.top + window.scrollY,
    docBottom: rect.bottom + window.scrollY,
    clip,
    obscured,
    obscuredBy,
    outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
  };
}

/** ブラウザ側で実行する。外側の変数は参照できない。 */
function collectStatic(clickSelectors: string[]): StaticReport {
  const kikori = window.__kikori;
  // 複合ウィジェットの中で tabindex="-1" を使い分ける役割 (tab, menuitem, option など) は含めない。
  const STANDALONE_ROLES = ["button", "link", "checkbox", "switch", "textbox", "searchbox", "combobox", "slider", "spinbutton"];
  const NATIVE = "a[href], button, input, select, textarea, summary, [contenteditable]";

  const usable = (el: Element): boolean =>
    kikori.isVisible(el) && el.getAttribute("aria-disabled") !== "true" && el.closest("[inert], [aria-hidden='true']") === null;
  const focusable = (el: Element): boolean => el.hasAttribute("tabindex") || el.matches(NATIVE);

  const positiveTabindex = Array.from(document.querySelectorAll("[tabindex]"))
    .filter((el) => Number(el.getAttribute("tabindex")) > 0 && kikori.isVisible(el))
    .map(kikori.describe);

  const unreachableRoles = Array.from(document.querySelectorAll(STANDALONE_ROLES.map((r) => `[role="${r}"]`).join(",")))
    .filter((el) => usable(el) && !focusable(el))
    .map(kikori.describe);

  const withClick = new Set<Element>(document.querySelectorAll("[onclick]"));
  for (const selector of clickSelectors) {
    try {
      const el = document.querySelector(selector);
      if (el && el !== document.body && el !== document.documentElement) withClick.add(el);
    } catch {
      // セレクタとして使えない文字列 (document、window など) は対象外。
    }
  }
  const clickOnly = Array.from(withClick)
    .filter((el) => usable(el) && !focusable(el) && !el.hasAttribute("role") && el.closest(NATIVE) === null && el.querySelector(NATIVE) === null)
    .map(kikori.describe);

  return { positiveTabindex, unreachableRoles, clickOnly };
}
