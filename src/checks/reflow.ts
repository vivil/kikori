import { tr } from "../i18n.js";
import { withPage } from "../browser.js";
import { SC, summarize, type CheckResult, type Finding } from "../types.js";
import type { ElementInfo } from "../helpers.js";

export interface ReflowOptions {
  url: string;
  /** 検査する幅。1280px を 400% に拡大した状態が 320px にあたる。 */
  width?: number;
  height?: number;
  waitForSelector?: string;
  waitMs?: number;
}

interface Overflowing extends ElementInfo {
  overflowPx: number;
  /** 表や画像など、2 次元のレイアウトが必要なコンテンツか */
  twoDimensional: boolean;
  fixed: boolean;
}

interface ScrollRegion extends ElementInfo {
  scrollWidth: number;
  clientWidth: number;
  twoDimensional: boolean;
}

interface OverflowReport {
  viewportWidth: number;
  documentScrollWidth: number;
  overflowing: Overflowing[];
  scrollRegions: ScrollRegion[];
}

const BASELINE = { width: 1280, height: 720 };
const TEXT_LIMIT = 3000;
const MAX_REPORTED = 20;

export async function checkReflow(options: ReflowOptions): Promise<CheckResult> {
  const viewport = { width: options.width ?? 320, height: options.height ?? 256 };

  return withPage({ ...options, viewport: BASELINE }, async (page) => {
    // 広い画面での状態を基準にして、狭めたときに新しく切れた文字だけを拾う。
    await page.evaluate((limit) => window.__kikori.collectText(limit), TEXT_LIMIT);
    const before = await page.evaluate(() => window.__kikori.measureText());

    // 1.4.4: 200% に拡大した状態 (幅 640px) で、文字が切れていないか。もとから切れているものも含めて拾う。
    await page.setViewportSize({ width: BASELINE.width / 2, height: BASELINE.height / 2 });
    await page.waitForTimeout(200);
    const zoomed = await page.evaluate(() => window.__kikori.measureText());

    await page.setViewportSize(viewport);
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => window.__kikori.measureText());
    const report = await page.evaluate(collectOverflow);

    const findings: Finding[] = [];
    const pageScrolls = report.documentScrollWidth > report.viewportWidth + 1;

    for (const el of report.overflowing.slice(0, MAX_REPORTED)) {
      const details = { overflowPx: el.overflowPx, text: el.text, viewportWidth: report.viewportWidth };
      if (el.twoDimensional) {
        findings.push({
          sc: SC.reflow,
          severity: "review",
          selector: el.selector,
          message: tr(`幅 ${viewport.width}px で右に ${el.overflowPx}px はみ出しています。表や画像など 2 次元の表示が欠かせない内容であれば例外にあたるため、必要性を確認してください。`, `Overflows the right edge by ${el.overflowPx}px at ${viewport.width}px wide. Content that needs a two-dimensional layout, such as tables or images, is exempt; confirm that this is such content.`),
          details,
        });
      } else if (el.fixed || !pageScrolls) {
        findings.push({
          sc: SC.reflow,
          severity: "review",
          selector: el.selector,
          message: tr(`幅 ${viewport.width}px で右に ${el.overflowPx}px はみ出し、画面の外に出た部分が見えません。内容が欠けていないか確認してください。`, `Overflows the right edge by ${el.overflowPx}px at ${viewport.width}px wide, and the part outside the viewport cannot be seen. Check that no content is lost.`),
          details,
        });
      } else {
        findings.push({
          sc: SC.reflow,
          severity: "fail",
          selector: el.selector,
          message: tr(`幅 ${viewport.width}px で右に ${el.overflowPx}px はみ出し、ページに横スクロールが発生しています。`, `Overflows the right edge by ${el.overflowPx}px at ${viewport.width}px wide and makes the page scroll horizontally.`),
          details,
        });
      }
    }

    if (pageScrolls && !findings.some((f) => f.severity === "fail")) {
      findings.push({
        sc: SC.reflow,
        severity: report.overflowing.length > 0 ? "review" : "fail",
        selector: "html",
        message: tr(`幅 ${viewport.width}px でページ全体が横に ${report.documentScrollWidth - report.viewportWidth}px スクロールします。`, `The whole page scrolls horizontally by ${report.documentScrollWidth - report.viewportWidth}px at ${viewport.width}px wide.`),
        details: { documentScrollWidth: report.documentScrollWidth, viewportWidth: report.viewportWidth },
      });
    }

    for (const region of report.scrollRegions.slice(0, MAX_REPORTED)) {
      if (region.twoDimensional) continue;
      findings.push({
        sc: SC.reflow,
        severity: "review",
        selector: region.selector,
        message: tr(`幅 ${viewport.width}px で、この領域の中に横スクロールが発生しています (内容 ${region.scrollWidth}px / 表示 ${region.clientWidth}px)。文章を読むのに縦横 2 方向のスクロールが要らないか確認してください。`, `This region scrolls horizontally at ${viewport.width}px wide (content ${region.scrollWidth}px / visible ${region.clientWidth}px). Check that reading the text does not require scrolling in two directions.`),
        details: { scrollWidth: region.scrollWidth, clientWidth: region.clientWidth, text: region.text },
      });
    }

    const newlyClipped: number[] = [];
    after.forEach((m, i) => {
      const base = before[i];
      if (m.visible && m.clipped && base && !(base.visible && base.clipped)) newlyClipped.push(i);
    });
    if (newlyClipped.length > 0) {
      const infos = await page.evaluate(
        (indexes) => indexes.map((i) => window.__kikori.describe(window.__kikori.textElement(i)!)),
        newlyClipped.slice(0, MAX_REPORTED),
      );
      for (const info of infos) {
        findings.push({
          sc: SC.reflow,
          severity: "review",
          selector: info.selector,
          message: tr(`幅 ${viewport.width}px にすると文字が切れて見えなくなります。省略された内容をほかの手段で読めるか確認してください。`, `Text is clipped and hidden at ${viewport.width}px wide. Check that the omitted content can be read some other way.`),
          details: { text: info.text },
        });
      }
    }

    const clippedWhenZoomed: number[] = [];
    zoomed.forEach((m, i) => {
      if (m.visible && m.clipped) clippedWhenZoomed.push(i);
    });
    if (clippedWhenZoomed.length > 0) {
      const infos = await page.evaluate(
        (indexes) => indexes.map((i) => window.__kikori.describe(window.__kikori.textElement(i)!)),
        clippedWhenZoomed.slice(0, MAX_REPORTED),
      );
      for (const info of infos) {
        findings.push({
          sc: SC.resizeText,
          severity: "review",
          selector: info.selector,
          message: tr(
            "200% に拡大すると、文字が親要素の overflow で切れています。切れた内容をほかの手段で読めるか確認してください。読めない場合は、高さや幅を固定せず、内容に合わせて伸びるようにしてください。",
            "At 200% zoom the text is clipped by an ancestor's overflow. Check that the clipped content can be read some other way. If not, do not fix the height or width; let the box grow with its content.",
          ),
          details: { text: info.text },
        });
      }
    }

    const notes: string[] = [];
    if (clippedWhenZoomed.length > MAX_REPORTED) {
      notes.push(
        tr(
          `200% に拡大すると文字が切れる要素は ${clippedWhenZoomed.length} 件あり、先頭の ${MAX_REPORTED} 件だけを報告しています。`,
          `${clippedWhenZoomed.length} elements have clipped text at 200% zoom; only the first ${MAX_REPORTED} are reported.`,
        ),
      );
    }
    if (report.overflowing.length > MAX_REPORTED) {
      notes.push(tr(`はみ出した要素は ${report.overflowing.length} 件あり、はみ出し量の大きい ${MAX_REPORTED} 件だけを報告しています。`, `${report.overflowing.length} elements overflow; only the ${MAX_REPORTED} largest are reported.`));
    }
    if (newlyClipped.length > MAX_REPORTED) {
      notes.push(tr(`文字が切れた要素は ${newlyClipped.length} 件あり、先頭の ${MAX_REPORTED} 件だけを報告しています。`, `${newlyClipped.length} elements have clipped text; only the first ${MAX_REPORTED} are reported.`));
    }

    return {
      check: "reflow",
      url: options.url,
      viewport,
      summary: summarize(findings),
      findings,
      checked: ["1.4.4", "1.4.10"],
      data: { viewportWidth: report.viewportWidth, documentScrollWidth: report.documentScrollWidth },
      ...(notes.length > 0 ? { notes } : {}),
    };
  });
}

/** ブラウザ側で実行する。外側の変数は参照できない。 */
function collectOverflow(): OverflowReport {
  const kikori = window.__kikori;
  const viewportWidth = document.documentElement.clientWidth;
  const documentScrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  const TWO_DIMENSIONAL = "table, pre, img, picture, video, canvas, svg, iframe, object, embed, math";

  /** 祖先のどこかで横方向が切られているか、スクロールできるなら、ページ全体の横幅には影響しない。 */
  const containedByAncestor = (el: Element): boolean => {
    for (let cur = el.parentElement; cur && cur !== document.body && cur !== document.documentElement; cur = cur.parentElement) {
      if (getComputedStyle(cur).overflowX !== "visible") return true;
    }
    return false;
  };

  const candidates = new Set<Element>();
  const scrollRegions: ScrollRegion[] = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (!kikori.isVisible(el)) continue;
    const style = getComputedStyle(el);
    if ((style.overflowX === "auto" || style.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1) {
      scrollRegions.push({
        ...kikori.describe(el),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        twoDimensional: el.matches(TWO_DIMENSIONAL) || el.querySelector(TWO_DIMENSIONAL) !== null,
      });
    }
    const rect = el.getBoundingClientRect();
    if (rect.right > viewportWidth + 1 && rect.left < viewportWidth && !containedByAncestor(el)) candidates.add(el);
  }

  // 親子がそろってはみ出しているときは、原因に近い子のほうだけを残す。
  const overflowing: Overflowing[] = [];
  for (const el of candidates) {
    if (Array.from(el.children).some((child) => candidates.has(child))) continue;
    const rect = el.getBoundingClientRect();
    overflowing.push({
      ...kikori.describe(el),
      overflowPx: Math.round(rect.right - viewportWidth),
      twoDimensional: el.closest(TWO_DIMENSIONAL) !== null,
      fixed: getComputedStyle(el).position === "fixed",
    });
  }
  overflowing.sort((a, b) => b.overflowPx - a.overflowPx);
  return { viewportWidth, documentScrollWidth, overflowing, scrollRegions };
}
