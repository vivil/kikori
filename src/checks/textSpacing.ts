import { tr } from "../../packages/core/src/i18n.js";
import { withPage } from "../browser.js";
import { SC, summarize, type CheckResult, type Finding } from "../../packages/core/src/types.js";

export interface TextSpacingOptions {
  url: string;
  width?: number;
  height?: number;
  waitForSelector?: string;
  waitMs?: number;
}

/** 達成基準 1.4.12 が求める 4 つの値。利用者スタイルシートを模して !important で上書きする。 */
export const TEXT_SPACING_CSS = `
* {
  line-height: 1.5 !important;
  letter-spacing: 0.12em !important;
  word-spacing: 0.16em !important;
}
p {
  margin-bottom: 2em !important;
}
`;

const TEXT_LIMIT = 1500;
const MAX_REPORTED = 20;

export async function checkTextSpacing(options: TextSpacingOptions): Promise<CheckResult> {
  const viewport = { width: options.width ?? 1280, height: options.height ?? 720 };

  return withPage({ ...options, viewport }, async (page) => {
    const count = await page.evaluate((limit) => window.__kikori.collectText(limit), TEXT_LIMIT);
    const before = await page.evaluate(() => window.__kikori.measureText());
    const overlapsBefore = new Set(await page.evaluate(() => window.__kikori.overlappingPairs()));

    // style 要素を差し込むと、ページの Content Security Policy に止められることがある。
    // スクリプトから作るスタイルシートは対象外なので、そちらで上書きする。
    await page.evaluate((css) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }, TEXT_SPACING_CSS);
    await page.waitForTimeout(150);

    const after = await page.evaluate(() => window.__kikori.measureText());
    const overlapsAfter = await page.evaluate(() => window.__kikori.overlappingPairs());

    const findings: Finding[] = [];

    const newlyClipped: number[] = [];
    after.forEach((m, i) => {
      const base = before[i];
      if (m.visible && m.clipped && base && !(base.visible && base.clipped)) newlyClipped.push(i);
    });
    const clippedInfos = await page.evaluate(
      (indexes) => indexes.map((i) => window.__kikori.describe(window.__kikori.textElement(i)!)),
      newlyClipped.slice(0, MAX_REPORTED),
    );
    for (const info of clippedInfos) {
      findings.push({
        sc: SC.textSpacing,
        severity: "fail",
        selector: info.selector,
        message: tr("テキストの間隔を広げると、文字が親要素の overflow で切れて読めなくなります。高さや幅を固定せず、内容に合わせて伸びるようにしてください。", "With the text spacing applied, the text is clipped by an ancestor's overflow and cannot be read. Do not fix the height or width; let the box grow with its content."),
        details: { text: info.text },
      });
    }

    const clippedSet = new Set(newlyClipped);
    const newOverlaps = overlapsAfter
      .filter((pair) => !overlapsBefore.has(pair))
      .map((pair) => pair.split(":").map(Number) as [number, number])
      // 切れている要素はすでに報告済みなので、重なりとしては数えない。
      .filter(([a, b]) => !clippedSet.has(a) && !clippedSet.has(b));
    const overlapInfos = await page.evaluate(
      (pairs) =>
        pairs.map(([a, b]) => ({
          first: window.__kikori.describe(window.__kikori.textElement(a)!),
          second: window.__kikori.describe(window.__kikori.textElement(b)!),
        })),
      newOverlaps.slice(0, MAX_REPORTED),
    );
    for (const { first, second } of overlapInfos) {
      findings.push({
        sc: SC.textSpacing,
        severity: "fail",
        selector: first.selector,
        message: tr(`テキストの間隔を広げると、別の文字 (${second.selector}) と重なります。高さを固定している箇所がないか確認してください。`, `With the text spacing applied, the text overlaps other text (${second.selector}). Check for a fixed height.`),
        details: { text: first.text, overlapsWith: second.selector, overlapsWithText: second.text },
      });
    }

    const notes: string[] = [];
    if (count >= TEXT_LIMIT) {
      notes.push(tr(`文字を持つ要素が多いため、先頭の ${TEXT_LIMIT} 件だけを検査しました。`, `Too many elements contain text; only the first ${TEXT_LIMIT} were checked.`));
    }
    if (newlyClipped.length > MAX_REPORTED || newOverlaps.length > MAX_REPORTED) {
      notes.push(tr(`指摘が多いため、種類ごとに先頭の ${MAX_REPORTED} 件だけを報告しています (切れ ${newlyClipped.length} 件 / 重なり ${newOverlaps.length} 件)。`, `Too many findings; only the first ${MAX_REPORTED} of each kind are reported (clipped ${newlyClipped.length} / overlapping ${newOverlaps.length}).`));
    }

    return {
      check: "text_spacing",
      url: options.url,
      viewport,
      summary: summarize(findings),
      findings,
      checked: ["1.4.12"],
      data: { inspectedTextElements: count },
      ...(notes.length > 0 ? { notes } : {}),
    };
  });
}
