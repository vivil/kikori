import { tr } from "../../packages/core/src/i18n.js";
import { withPage } from "../browser.js";
import { changedRegions, decodePng, type Region } from "../pixels.js";
import { SC, summarize, type CheckResult, type Finding } from "../../packages/core/src/types.js";
import type { ElementInfo } from "../helpers.js";

export interface PresentationOptions {
  url: string;
  width?: number;
  height?: number;
  waitForSelector?: string;
  waitMs?: number;
}

interface SmallTarget extends ElementInfo {
  width: number;
  height: number;
}

interface TextBlock extends ElementInfo {
  justified: boolean;
  /** 行の高さを文字サイズで割った値 */
  lineHeightRatio: number;
  /** 1 行に入るおよその文字数 */
  charsPerLine: number;
  charLimit: number;
}

interface StaticReport {
  smallTargets: SmallTarget[];
  /** 24 × 24px に届かず、周りとの間隔も足りないターゲット */
  crowdedTargets: SmallTarget[];
  textBlocks: TextBlock[];
  autoplay: (ElementInfo & { hasControls: boolean; seconds: number | null; pageHasButtons: boolean })[];
  hasMedia: boolean;
  hasFormControls: boolean;
  /** 個人の情報を集めていそうなのに、autocomplete の指定がない入力欄 */
  missingAutocomplete: (ElementInfo & { hint: string })[];
}

interface MovingElement extends ElementInfo {
  durationMs: number | null;
}

const MAX_REPORTED = 15;
const MIN_TARGET = 44;
/** 読み込みからこの時間が過ぎたあとの動きを調べる (ミリ秒) */
const MOTION_AFTER_MS = 5000;
/** 撮り比べる枚数と、その間隔 (ミリ秒) */
const MOTION_FRAMES = 3;
const MOTION_INTERVAL_MS = 400;

export async function checkPresentation(options: PresentationOptions): Promise<CheckResult> {
  const viewport = { width: options.width ?? 1280, height: options.height ?? 720 };

  return withPage({ ...options, viewport }, async (page) => {
    const loadedAt = Date.now();
    const findings: Finding[] = [];
    const notes: string[] = [];
    const report = await page.evaluate(collectStatic, MIN_TARGET);

    for (const target of report.smallTargets.slice(0, MAX_REPORTED)) {
      findings.push({
        sc: SC.targetSize,
        severity: "fail",
        selector: target.selector,
        message: tr(`押せる範囲が ${target.width} × ${target.height}px で、${MIN_TARGET} × ${MIN_TARGET}px に届きません。padding や min-height で広げてください。`, `The target is ${target.width} × ${target.height}px, smaller than ${MIN_TARGET} × ${MIN_TARGET}px. Enlarge it with padding or min-height.`),
        details: { width: target.width, height: target.height, text: target.text },
      });
    }
    if (report.smallTargets.length > MAX_REPORTED) {
      notes.push(tr(`小さいターゲットは ${report.smallTargets.length} 件あり、小さい順に ${MAX_REPORTED} 件だけを報告しています。`, `${report.smallTargets.length} small targets found; only the ${MAX_REPORTED} smallest are reported.`));
    }

    for (const target of report.crowdedTargets.slice(0, MAX_REPORTED)) {
      findings.push({
        sc: SC.targetSizeMinimum,
        severity: "fail",
        selector: target.selector,
        message: tr(
          `押せる範囲が ${target.width} × ${target.height}px で、24 × 24px に届きません。隣の操作部品との間隔も足りないため、押し間違えやすくなっています。大きさか間隔を広げてください。`,
          `The target is ${target.width} × ${target.height}px, smaller than 24 × 24px, and it is too close to a neighbouring control for the spacing exception to apply. Enlarge it or add spacing.`,
        ),
        details: { width: target.width, height: target.height, text: target.text },
      });
    }
    if (report.crowdedTargets.length > MAX_REPORTED) {
      notes.push(
        tr(
          `24px に届かず間隔も足りないターゲットは ${report.crowdedTargets.length} 件あり、小さい順に ${MAX_REPORTED} 件だけを報告しています。`,
          `${report.crowdedTargets.length} targets are below 24px without enough spacing; only the ${MAX_REPORTED} smallest are reported.`,
        ),
      );
    }

    const justified = report.textBlocks.filter((b) => b.justified);
    const tight = report.textBlocks.filter((b) => b.lineHeightRatio < 1.5);
    const long = report.textBlocks.filter((b) => b.charsPerLine > b.charLimit);
    for (const block of justified.slice(0, MAX_REPORTED)) {
      findings.push({
        sc: SC.visualPresentation,
        severity: "fail",
        selector: block.selector,
        message: tr("文章が両端揃えになっています。単語や文字の間隔が不ぞろいになるため、左揃えにしてください。", "The text is justified. Spacing between words and characters becomes uneven; align it to the left."),
        details: { text: block.text },
      });
    }
    for (const block of tight.slice(0, MAX_REPORTED)) {
      findings.push({
        sc: SC.visualPresentation,
        severity: "fail",
        selector: block.selector,
        message: tr(`行の高さが文字サイズの ${block.lineHeightRatio.toFixed(2)} 倍で、1.5 倍に届きません。`, `Line height is ${block.lineHeightRatio.toFixed(2)} times the font size, below 1.5.`),
        details: { lineHeightRatio: Number(block.lineHeightRatio.toFixed(2)), text: block.text },
      });
    }
    for (const block of long.slice(0, MAX_REPORTED)) {
      findings.push({
        sc: SC.visualPresentation,
        severity: "review",
        selector: block.selector,
        message: tr(`1 行がおよそ ${Math.round(block.charsPerLine)} 文字で、目安の ${block.charLimit} 文字を超えています。利用者が幅を狭められるか、max-width の指定を確認してください。`, `A line holds roughly ${Math.round(block.charsPerLine)} characters, above the guideline of ${block.charLimit}. Check that users can narrow the text, or set a max-width.`),
        details: { charsPerLine: Math.round(block.charsPerLine), charLimit: block.charLimit, text: block.text },
      });
    }
    const groups = [
      [tr("両端揃え", "justified text"), justified],
      [tr("行の高さ", "line height"), tight],
      [tr("行の長さ", "line length"), long],
    ] as const;
    for (const [label, list] of groups) {
      if (list.length > MAX_REPORTED) {
        notes.push(tr(`${label}の指摘は ${list.length} 件あり、先頭の ${MAX_REPORTED} 件だけを報告しています。`, `${list.length} findings for ${label}; only the first ${MAX_REPORTED} are reported.`));
      }
    }

    for (const media of report.autoplay) {
      // controls 属性があれば、利用者は止められる。指摘しない。
      if (media.hasControls) continue;
      // 音声の要素が 3 秒を超えて鳴り、止めるためのボタンもページにないときは、不適合と判断する。
      // 動画は音声を含まないことがあり、長さが分からないものもあるので、確認を求めるにとどめる。
      const certain = media.tag === "audio" && !media.pageHasButtons && media.seconds !== null && media.seconds > 3;
      findings.push({
        sc: SC.audioControl,
        severity: certain ? "fail" : "review",
        selector: media.selector,
        message: certain
          ? tr(
              `音声が自動で再生され、3 秒を超えて続きます。controls 属性も、止めるためのボタンもありません。停止や音量調整の手段を用意してください。`,
              `Audio plays automatically for more than 3 seconds, and there is neither a controls attribute nor a button to stop it. Provide a way to stop it or adjust its volume.`,
            )
          : tr(
              "音声つきのメディアが自動で再生され、controls 属性もありません。3 秒を超えて続く場合は、停止や音量調整の手段が必要です。",
              "Media with sound plays automatically and has no controls attribute. If it lasts more than 3 seconds, a way to stop it or adjust its volume is required.",
            ),
        details: { seconds: media.seconds !== null && Number.isFinite(media.seconds) ? Math.round(media.seconds) : null, pageHasButtons: media.pageHasButtons },
      });
    }

    for (const input of report.missingAutocomplete.slice(0, MAX_REPORTED)) {
      findings.push({
        sc: SC.inputPurpose,
        severity: "review",
        selector: input.selector,
        message: tr(`利用者自身の情報 (${input.hint}) を入力する欄に見えますが、autocomplete 属性がありません。該当する場合は、対応する値を指定してください。`, `Looks like a field for the user's own information (${input.hint}) but has no autocomplete attribute. If so, set the matching value.`),
        details: { hint: input.hint, text: input.text },
      });
    }

    // 動きの検査では、利用者が動きを減らす設定にしていない状態を基準にする。
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(100);
    const moving = await page.evaluate(collectMoving);

    // 宣言のない動き (スクリプトによる書き換え、動画、GIF、canvas) は、画面を撮り比べて見つける。
    // 2.2.2 が問題にするのは 5 秒を超えて続く動きなので、読み込みから 5 秒が過ぎるのを待つ。
    await page.waitForTimeout(Math.max(0, MOTION_AFTER_MS - (Date.now() - loadedAt)));
    const frames = [];
    for (let i = 0; i < MOTION_FRAMES; i++) {
      if (i > 0) await page.waitForTimeout(MOTION_INTERVAL_MS);
      frames.push(decodePng(await page.screenshot({ type: "png", caret: "hide" })));
    }
    const regions: Region[] = [];
    for (let i = 1; i < frames.length; i++) regions.push(...changedRegions(frames[i - 1]!, frames[i]!));
    const undeclared = await page.evaluate(locateMotion, { regions: regions.slice(0, 60), declared: moving.map((m) => m.selector) });
    for (const el of undeclared.slice(0, MAX_REPORTED)) {
      findings.push({
        sc: SC.pauseStopHide,
        severity: "review",
        selector: el.selector,
        message: tr(
          "読み込みから 5 秒を過ぎても、この部分の表示が変わり続けています。ほかの内容と並んで表示される場合は、一時停止、停止、非表示のいずれかの手段があるか確認してください。",
          "This part of the page is still changing more than 5 seconds after load. If it is shown alongside other content, check that it can be paused, stopped or hidden.",
        ),
        details: { detectedBy: "frames", tag: el.tag, region: el.region, text: el.text },
      });
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(100);
    const stillMoving = new Set((await page.evaluate(collectMoving)).map((m) => m.selector));
    for (const el of moving.slice(0, MAX_REPORTED)) {
      const respects = !stillMoving.has(el.selector);
      findings.push({
        sc: SC.pauseStopHide,
        severity: "review",
        selector: el.selector,
        message: tr(`${el.durationMs === null ? "終わりのない" : `${Math.round(el.durationMs / 1000)} 秒続く`}アニメーションが自動で動いています。ほかの内容と並んで表示される場合は、一時停止、停止、非表示のいずれかの手段が必要です。`, `${el.durationMs === null ? "An endless animation" : `An animation lasting ${Math.round(el.durationMs / 1000)} seconds`} starts automatically. If it is shown alongside other content, a way to pause, stop or hide it is required.`),
        details: { detectedBy: "declared", durationMs: el.durationMs, stopsWithReducedMotion: respects, text: el.text },
      });
    }

    return {
      check: "presentation",
      url: options.url,
      viewport,
      summary: summarize(findings),
      findings,
      checked: ["1.4.8", "2.2.2", "2.5.5", "2.5.8", ...(report.hasMedia ? ["1.4.2"] : []), ...(report.hasFormControls ? ["1.3.5"] : [])],
      // 音声や映像を埋め込む要素、入力欄がなければ、それぞれに関する達成基準は該当しないと推定する。
      inapplicable: [
        ...(report.hasMedia ? [] : ["1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.2.5", "1.2.6", "1.2.7", "1.2.8", "1.2.9", "1.4.2", "1.4.7"]),
        ...(report.hasFormControls ? [] : ["1.3.5", "3.3.1", "3.3.2", "3.3.3", "3.3.4", "3.3.5", "3.3.6"]),
      ],
      data: { hasMedia: report.hasMedia, hasFormControls: report.hasFormControls },
      ...(notes.length > 0 ? { notes } : {}),
    };
  });
}

/** ブラウザ側で実行する。外側の変数は参照できない。 */
function collectStatic(minTarget: number): StaticReport {
  const kikori = window.__kikori;
  const INTERACTIVE =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';

  const hasSiblingText = (el: Element): boolean => {
    const parent = el.parentElement;
    if (!parent) return false;
    for (const node of parent.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "") return true;
    }
    return false;
  };

  const smallTargets: SmallTarget[] = [];
  /** 画面上の操作部品の位置。24px の基準で、間隔を確かめるのに使う。 */
  const placed: { el: Element; rect: DOMRect }[] = [];
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if ((el as HTMLInputElement).disabled || el.closest("[inert], [aria-hidden='true']")) continue;
    let rect = el.getBoundingClientRect();
    // ラベルと結び付いた入力欄は、ラベルも押せる範囲に含まれる。
    const label = (el as HTMLInputElement).labels?.[0];
    if (label) {
      const l = label.getBoundingClientRect();
      const left = Math.min(rect.left, l.left);
      const top = Math.min(rect.top, l.top);
      rect = new DOMRect(left, top, Math.max(rect.right, l.right) - left, Math.max(rect.bottom, l.bottom) - top);
    } else if (!kikori.isVisible(el)) {
      continue;
    }
    if (rect.width <= 0 || rect.height <= 0) continue;
    // 文章の中に置かれたリンクは、達成基準の例外にあたる。
    const inline = getComputedStyle(el).display === "inline" && hasSiblingText(el);
    if (!inline) placed.push({ el, rect });
    if (rect.width >= minTarget && rect.height >= minTarget) continue;
    if (inline) continue;
    smallTargets.push({ ...kikori.describe(el), width: Math.round(rect.width), height: Math.round(rect.height) });
  }
  smallTargets.sort((a, b) => a.width * a.height - b.width * b.height);

  // 2.5.8: 24 × 24px に届かないターゲットは、中心に置いた直径 24px の円が、ほかのターゲットにも、
  // ほかの小さいターゲットの円にも重ならなければ、間隔による例外として認められる。
  const MIN = 24;
  const undersized = placed.filter(({ rect }) => rect.width < MIN || rect.height < MIN);
  const center = (rect: DOMRect): { x: number; y: number } => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  const crowdedTargets: SmallTarget[] = [];
  for (const target of undersized) {
    const c = center(target.rect);
    const crowded = placed.some((other) => {
      if (other.el === target.el || other.el.contains(target.el) || target.el.contains(other.el)) return false;
      if (other.rect.width < MIN || other.rect.height < MIN) {
        const o = center(other.rect);
        return Math.hypot(c.x - o.x, c.y - o.y) < MIN;
      }
      const dx = Math.max(other.rect.left - c.x, 0, c.x - other.rect.right);
      const dy = Math.max(other.rect.top - c.y, 0, c.y - other.rect.bottom);
      return Math.hypot(dx, dy) < MIN / 2;
    });
    if (crowded) crowdedTargets.push({ ...kikori.describe(target.el), width: Math.round(target.rect.width), height: Math.round(target.rect.height) });
  }
  crowdedTargets.sort((a, b) => a.width * a.height - b.width * b.height);

  const textBlocks: TextBlock[] = [];
  for (const el of document.body.querySelectorAll("p, li, dd, blockquote")) {
    if (!kikori.isVisible(el)) continue;
    const text = ((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 20) continue;
    const style = getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize);
    if (!fontSize) continue;
    // line-height: normal は書体によるが、おおむね 1.2 倍前後になる。
    const lineHeight = style.lineHeight === "normal" ? fontSize * 1.2 : parseFloat(style.lineHeight);
    const rect = el.getBoundingClientRect();
    const lines = Math.round(rect.height / lineHeight);
    // 和文は全角 1 文字が 1em、欧文は 1 文字がおよそ 0.5em として見積もる。
    const cjk = (text.match(/[぀-ヿ㐀-鿿＀-￯]/g) ?? []).length / text.length > 0.3;
    const capacity = rect.width / (cjk ? fontSize : fontSize * 0.5);
    textBlocks.push({
      ...kikori.describe(el),
      justified: style.textAlign === "justify",
      // 1 行しかない文章では、行の高さも行の長さも読みやすさに影響しない。
      lineHeightRatio: lines >= 2 ? lineHeight / fontSize : 1.5,
      charsPerLine: lines >= 2 ? capacity : 0,
      charLimit: cjk ? 40 : 80,
    });
  }

  const autoplay = Array.from(document.querySelectorAll<HTMLMediaElement>("video[autoplay], audio[autoplay]"))
    .filter((m) => !m.muted)
    .map((m) => ({
      ...kikori.describe(m),
      hasControls: m.controls,
      // 繰り返し再生は、終わらないものとして扱う。長さが読めないときは null にする。
      seconds: m.loop ? Infinity : Number.isFinite(m.duration) ? m.duration : null,
      pageHasButtons: document.querySelector("button, [role='button'], input[type='button'], a[href]") !== null,
    }));

  const hasMedia = document.querySelector("video, audio, iframe, object, embed") !== null;

  const PURPOSES: [RegExp, string][] = [
    [/e-?mail|メール/i, "email"],
    [/tel|phone|電話/i, "tel"],
    [/zip|postal|郵便/i, "postal-code"],
    [/addr|住所/i, "street-address"],
    [/birth|bday|生年月日|誕生/i, "bday"],
    [/user-?name|login|ユーザー名/i, "username"],
    [/passw|パスワード/i, "current-password / new-password"],
    [/card|カード番号/i, "cc-number"],
    [/name|氏名|名前/i, "name"],
  ];
  const fields = Array.from(document.querySelectorAll<HTMLInputElement>("input, select, textarea")).filter(
    (el) => !["hidden", "submit", "button", "reset", "image", "file", "checkbox", "radio", "range", "color", "search"].includes(el.type),
  );
  const missingAutocomplete: (ElementInfo & { hint: string })[] = [];
  for (const field of fields) {
    if (field.getAttribute("autocomplete")?.trim() || field.disabled) continue;
    const label = field.labels?.[0]?.innerText ?? field.getAttribute("aria-label") ?? "";
    const clue = [field.type, field.name, field.id, field.getAttribute("placeholder") ?? "", label].join(" ");
    const purpose = PURPOSES.find(([pattern]) => pattern.test(clue));
    if (purpose) missingAutocomplete.push({ ...kikori.describe(field), text: label.trim().slice(0, 80), hint: purpose[1] });
  }
  const hasFormControls = document.querySelector("input:not([type='hidden']), select, textarea, [contenteditable]") !== null;

  return { smallTargets, crowdedTargets, textBlocks, autoplay, hasMedia, hasFormControls, missingAutocomplete };
}

/**
 * ブラウザ側で実行する。変化した範囲にある要素を返す。
 * すでにアニメーションの宣言から見つけた要素と、その内側や外側の要素は除く。
 */
function locateMotion(input: { regions: Region[]; declared: string[] }): (ElementInfo & { tag: string; region: Region })[] {
  const kikori = window.__kikori;
  const declared = input.declared.map((selector) => document.querySelector(selector)).filter((el): el is Element => el !== null);
  const found = new Map<Element, Region>();
  for (const region of input.regions) {
    const el = document.elementFromPoint(region.x + region.width / 2, region.y + region.height / 2);
    if (!el || el === document.documentElement || el === document.body) continue;
    if (declared.some((known) => known.contains(el) || el.contains(known))) continue;
    if ([...found.keys()].some((known) => known.contains(el) || el.contains(known))) continue;
    found.set(el, region);
  }
  return Array.from(found, ([el, region]) => ({ ...kikori.describe(el), tag: el.tagName.toLowerCase(), region }));
}

/** ブラウザ側で実行する。5 秒を超えて動き続ける要素を返す。 */
function collectMoving(): MovingElement[] {
  const kikori = window.__kikori;
  const found = new Map<Element, number | null>();
  for (const animation of document.getAnimations()) {
    if (animation.playState !== "running") continue;
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect) || !effect.target) continue;
    const timing = effect.getComputedTiming();
    const end = typeof timing.endTime === "number" ? timing.endTime : Number(timing.endTime);
    const endless = timing.iterations === Infinity || !Number.isFinite(end);
    if (!endless && end <= 5000) continue;
    if (!kikori.isVisible(effect.target)) continue;
    found.set(effect.target, endless ? null : end);
  }
  return Array.from(found, ([el, durationMs]) => ({ ...kikori.describe(el), durationMs }));
}
