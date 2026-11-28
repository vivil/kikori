import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { auditPage } from "./checks/audit.js";
import { checkAxe } from "./checks/axe.js";
import { checkInteraction } from "./checks/interaction.js";
import { checkPresentation } from "./checks/presentation.js";
import { auditSite } from "./checks/site.js";
import { checkKeyboardFocus } from "./checks/focus.js";
import { checkReflow } from "./checks/reflow.js";
import { checkTextSpacing } from "./checks/textSpacing.js";
import { captureScreenshot, collectEvidence, JUDGEABLE } from "./evidence.js";
import { tr } from "../packages/core/src/i18n.js";
import { packageVersion } from "./install.js";

const annotations = { readOnlyHint: true, openWorldHint: true } as const;

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type ToolResponse = { content: Content[]; isError?: boolean };

function failure(error: unknown): ToolResponse {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: tr(`実行できませんでした: ${message}`, `Could not run: ${message}`) }], isError: true };
}

async function respond(run: () => Promise<unknown>): Promise<ToolResponse> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await run(), null, 2) }] };
  } catch (error) {
    return failure(error);
  }
}

async function respondWithImages(run: () => Promise<{ body: unknown; images: { data: string; mimeType: string; description: string }[] }>): Promise<ToolResponse> {
  try {
    const { body, images } = await run();
    const content: Content[] = [{ type: "text", text: JSON.stringify(body, null, 2) }];
    for (const image of images) {
      content.push(
        { type: "text", text: tr(`スクリーンショット: ${image.description}`, `Screenshot: ${image.description}`) },
        { type: "image", data: image.data, mimeType: image.mimeType },
      );
    }
    return { content };
  } catch (error) {
    return failure(error);
  }
}

/** ツールの説明文は、起動時に決めた言語で作る。そのため、サーバーを作る時点で組み立てる。 */
export function createServer(): McpServer {
  const server = new McpServer({ name: "kikori", version: packageVersion() });

  const common = {
    url: z
      .string()
      .describe(tr("検査するページの URL (http / https / file)。開発サーバーの http://localhost:3000/ なども指定できる。", "URL of the page to check (http, https or file). A dev server such as http://localhost:3000/ works too.")),
    waitForSelector: z
      .string()
      .optional()
      .describe(tr("読み込み後、この CSS セレクタの要素が現れるまで待つ。SPA の描画待ちに使う。", "After load, wait until an element matching this CSS selector appears. Use it to wait for an SPA to render.")),
    waitMs: z.number().int().min(0).max(30_000).optional().describe(tr("読み込み後に追加で待つ時間 (ミリ秒)。", "Extra time to wait after load, in milliseconds.")),
  };
  const viewport = {
    width: z.number().int().min(200).max(4000).optional().describe(tr("ビューポートの幅 (CSS px)。既定値は 1280。", "Viewport width in CSS px. Default 1280.")),
    height: z.number().int().min(200).max(4000).optional().describe(tr("ビューポートの高さ (CSS px)。既定値は 720。", "Viewport height in CSS px. Default 720.")),
  };
  const level = z
    .enum(["A", "AA", "AAA"])
    .optional()
    .describe(tr("目標とする適合レベル。既定値は AA。", "Target conformance level. Default AA."));
  const wcag = z
    .enum(["2.1", "2.2"])
    .optional()
    .describe(tr("対象とする WCAG のバージョン。既定値は 2.2。", "WCAG version to audit against. Default 2.2."));
  const judgments = z
    .array(
      z.object({
        id: z.string().describe(tr("達成基準の番号 (例: 2.4.4)", "Success criterion number, e.g. 2.4.4")),
        verdict: z
          .enum(["pass", "fail", "inapplicable", "unsure"])
          .describe(tr("pass: 満たしている / fail: 不適合 / inapplicable: 該当する内容がない / unsure: 材料だけでは決められない", "pass: satisfied / fail: not satisfied / inapplicable: no relevant content / unsure: the material is not enough to decide")),
        reason: z.string().describe(tr("判断の根拠。何を見てそう判断したかを書く。", "Grounds for the judgment: what you looked at and why you decided so.")),
        evidence: z
          .string()
          .optional()
          .describe(tr("fail のときは必須。根拠にした箇所のセレクターか文言。省くと要確認として扱われる。", "Required for fail: the selector or the text the judgment relies on. Without it the judgment is treated as a review item.")),
      }),
    )
    .optional()
    .describe(
      tr(
        "collect_evidence の材料を見て下した判断。渡すと達成基準の一覧に反映される。自動検査で不適合が見つかった達成基準は、pass を渡しても不適合のままになる。",
        "Judgments made from the material returned by collect_evidence. They are reflected in the criteria list. A criterion that failed an automated check stays failed even if pass is supplied.",
      ),
    );

  server.registerTool(
    "check_reflow",
    {
      title: tr("リフローの検査 (WCAG 1.4.10)", "Reflow check (WCAG 1.4.10)"),
      description: tr(
        "ページを幅 320px (1280px を 400% に拡大した状態) で表示し、横スクロールの発生、画面の外にはみ出す要素、狭めたときに切れる文字を検出する。指摘には達成基準の番号と、対象要素の CSS セレクタが付く。severity が fail のものは機械的に確認できた不適合、review は人の判断が必要なもの。",
        "Renders the page at 320px wide (1280px zoomed to 400%) and detects horizontal scrolling, elements that overflow the viewport and text that gets clipped when narrowed. Each finding carries the success criterion and a CSS selector for the element. Severity fail is a failure confirmed mechanically; review needs a human decision.",
      ),
      inputSchema: {
        ...common,
        width: z.number().int().min(200).max(2000).optional().describe(tr("検査する幅 (CSS px)。既定値は 320。", "Width to check in CSS px. Default 320.")),
        height: z.number().int().min(200).max(2000).optional().describe(tr("検査する高さ (CSS px)。既定値は 256。", "Height to check in CSS px. Default 256.")),
      },
      annotations,
    },
    (args) => respond(() => checkReflow(args)),
  );

  server.registerTool(
    "check_text_spacing",
    {
      title: tr("テキスト間隔の検査 (WCAG 1.4.12)", "Text spacing check (WCAG 1.4.12)"),
      description: tr(
        "行の高さ 1.5、段落の後ろ 2em、字間 0.12em、単語間 0.16em を上書きし、その前後を比べて、新しく切れた文字と重なった文字を検出する。高さや幅を固定したボタン、カード、見出しで起きやすい不具合を見つける。",
        "Overrides line height to 1.5, paragraph spacing to 2em, letter spacing to 0.12em and word spacing to 0.16em, then compares before and after to detect text that becomes clipped or starts to overlap. Finds the problems typical of buttons, cards and headings with a fixed height or width.",
      ),
      inputSchema: { ...common, ...viewport },
      annotations,
    },
    (args) => respond(() => checkTextSpacing(args)),
  );

  server.registerTool(
    "check_keyboard_focus",
    {
      title: tr("キーボードフォーカスの検査 (WCAG 2.1.1 / 2.1.2 / 2.4.3 / 2.4.7 / 2.4.11 / 2.4.12 / 2.4.13 / 3.2.1)", "Keyboard focus check (WCAG 2.1.1 / 2.1.2 / 2.4.3 / 2.4.7 / 2.4.11 / 2.4.12 / 2.4.13 / 3.2.1)"),
      description: tr(
        "実際に Tab キーを押してページを一巡し、フォーカスの順序を記録する。フォーカス表示がない要素、固定ヘッダーなどに隠れる要素、フォーカスが抜け出せない箇所、キーボードで届かない操作部品、フォーカスだけで起きる画面の移動を検出する。data.sequence にフォーカス順の一覧が入るので、順序が意味の通るものかを判断できる。",
        "Presses Tab through the whole page and records the focus order. Detects elements with no focus indicator, elements hidden behind a fixed header or similar, places focus cannot leave, controls the keyboard cannot reach, and context changes triggered by focus alone. data.sequence lists the focus order so you can judge whether it makes sense.",
      ),
      inputSchema: {
        ...common,
        ...viewport,
        maxSteps: z.number().int().min(1).max(1000).optional().describe(tr("Tab キーを押す回数の上限。既定値は 150。", "Maximum number of Tab presses. Default 150.")),
      },
      annotations,
    },
    (args) => respond(() => checkKeyboardFocus(args)),
  );

  server.registerTool(
    "check_axe",
    {
      title: tr("axe-core による検査", "axe-core check"),
      description: tr(
        "axe-core のルールを実行し、代替テキスト、コントラスト、ラベル、ARIA、言語指定、見出し構造などの不備を検出する。結果は達成基準ごとに整理して返す。自動で判定できなかったものは review になる。",
        "Runs the axe-core rules and detects problems with text alternatives, contrast, labels, ARIA, language declarations, heading structure and more. Results are organised by success criterion. Anything axe could not decide becomes review.",
      ),
      inputSchema: { ...common, level, wcag, ...viewport },
      annotations,
    },
    (args) => respond(() => checkAxe(args)),
  );

  server.registerTool(
    "check_presentation",
    {
      title: tr("ターゲットのサイズ・視覚的提示・動きの検査 (WCAG 2.5.5 / 2.5.8 / 1.4.8 / 2.2.2 / 1.4.2 / 1.3.5)", "Target size, visual presentation and motion check (WCAG 2.5.5 / 2.5.8 / 1.4.8 / 2.2.2 / 1.4.2 / 1.3.5)"),
      description: tr(
        "押せる範囲が 44 × 44px に届かない操作部品、24 × 24px に届かず隣との間隔も足りない操作部品、両端揃えや行の高さ・行の長さが基準を外れる文章、5 秒を超えて動き続けるアニメーションや表示 (アニメーションの宣言と、5 秒後に撮り比べた画面から見つける)、音声つきの自動再生、autocomplete のない個人情報の入力欄を検出する。2.5.5 と 1.4.8 はレベル AAA、2.5.8 は WCAG 2.2 のレベル AA の達成基準。",
        "Detects controls whose target is smaller than 44 × 44px, controls below 24 × 24px that are also too close to a neighbour, text that is justified or whose line height or line length is out of range, animations and other content that keep moving for more than 5 seconds (found from the declared animations and by comparing screenshots taken after 5 seconds), autoplaying media with sound, and personal-data fields without autocomplete. 2.5.5 and 1.4.8 are Level AAA criteria; 2.5.8 is a Level AA criterion of WCAG 2.2.",
      ),
      inputSchema: { ...common, ...viewport },
      annotations,
    },
    (args) => respond(() => checkPresentation(args)),
  );

  server.registerTool(
    "check_interaction",
    {
      title: tr(
        "操作して確かめる検査 (WCAG 1.4.13 / 2.1.4 / 3.2.2 / 2.5.1 / 2.5.2 / 2.5.4 / 2.5.7 / 3.3.8 / 1.4.11 / 2.3.1 / 4.1.3)",
        "Interaction check (WCAG 1.4.13 / 2.1.4 / 3.2.2 / 2.5.1 / 2.5.2 / 2.5.4 / 2.5.7 / 3.3.8 / 1.4.11 / 2.3.1 / 4.1.3)",
      ),
      description: tr(
        "実際に操作して確かめる。要素にホバーして現れた内容が消せるか・ポインタを載せられるか、文字キーだけで動くショートカットがないか、入力欄の値を変えただけで画面が移動しないかを調べる。あわせて、ポインタや端末の動きを受け取るイベントリスナー、入力欄の境界のコントラスト、速い点滅、ステータスメッセージの領域、ドラッグで操作する要素、貼り付けを拒否するパスワード欄や CAPTCHA を調べる。ページを移動する要求と GET 以外の要求は止めるので、サーバー側のデータは変えない。",
        "Checks by actually operating the page. Hovers elements to see whether the revealed content can be dismissed and hovered, looks for shortcuts triggered by a character key alone, and checks that changing a field's value does not move the page. Also inspects event listeners for pointer and device motion, the contrast of field boundaries, fast flashing, status message regions, elements operated by dragging, and password fields that reject paste or CAPTCHAs. Navigation requests and non-GET requests are blocked, so no data on the server is changed.",
      ),
      inputSchema: { ...common, ...viewport },
      annotations,
    },
    (args) => respond(() => checkInteraction(args)),
  );

  server.registerTool(
    "collect_evidence",
    {
      title: tr("判断材料の収集", "Collect evidence for judgment"),
      description: tr(
        `機械的には判定できず、内容を見て判断する達成基準について、判断材料を集めて返す。対応している達成基準は ${JUDGEABLE.join("、")}。それぞれに、答えるべき問い (question)、不適合とする条件 (failWhen)、材料 (evidence: 画像と代替テキストの一覧、HTML 順の文章、リンクの文言と文脈、見出しとラベルなど) が付く。ページ全体のスクリーンショットも画像として返す。audit_page の結果で needs_judgment になった達成基準について呼び出し、判断を audit_page の judgments に渡して再実行する。`,
        `Gathers material for success criteria that cannot be decided mechanically and need a look at the content. Supported criteria: ${JUDGEABLE.join(", ")}. Each comes with the question to answer (question), the condition for failure (failWhen) and the material (evidence: images with their text alternatives, text in HTML order, link text with context, headings and labels, and so on). A full-page screenshot is returned as an image. Call it for criteria that audit_page marked needs_judgment, then run audit_page again with your decisions in judgments.`,
      ),
      inputSchema: {
        ...common,
        criteria: z
          .array(z.string())
          .optional()
          .describe(tr("材料を集める達成基準の番号。省くと、対応しているものすべてを集める。", "Success criteria to gather material for. Omit to gather for every supported one.")),
        screenshot: z.boolean().optional().describe(tr("ページ全体のスクリーンショットを付けるか。既定値は true。", "Whether to attach a full-page screenshot. Default true.")),
      },
      annotations,
    },
    (args) =>
      respondWithImages(async () => {
        const { screenshots, ...body } = await collectEvidence(args);
        return { body, images: screenshots };
      }),
  );

  server.registerTool(
    "capture_screenshot",
    {
      title: tr("スクリーンショットの撮影", "Capture a screenshot"),
      description: tr(
        "ページ、または selector で指定した要素のスクリーンショットを画像として返す。collect_evidence の全体像では細部が見えないとき、画像の中の文字、アイコンのコントラスト、指摘された要素の見た目を確かめるのに使う。width を 320 にすると、リフローした状態を確認できる。",
        "Returns a screenshot of the page, or of the element given by selector, as an image. Use it when the overview from collect_evidence lacks detail: to read text inside images, check icon contrast or look at an element named in a finding. Set width to 320 to see the reflowed layout.",
      ),
      inputSchema: {
        ...common,
        selector: z.string().optional().describe(tr("この CSS セレクタの要素だけを撮る。省くとページを撮る。", "Capture only the element matching this CSS selector. Omit to capture the page.")),
        fullPage: z
          .boolean()
          .optional()
          .describe(tr("ページ全体を撮るか。既定値は false (表示領域だけ)。selector を指定したときは無視される。", "Whether to capture the full page. Default false (viewport only). Ignored when selector is given.")),
        ...viewport,
      },
      annotations,
    },
    (args) =>
      respondWithImages(async () => {
        const shot = await captureScreenshot(args);
        return { body: { url: args.url, selector: args.selector ?? null }, images: [shot] };
      }),
  );

  server.registerTool(
    "audit_page",
    {
      title: tr("WCAG の全達成基準に対する監査", "Audit against every WCAG success criterion"),
      description: tr(
        "axe-core とこのサーバーの全検査を実行し、WCAG 2.2 (wcag で 2.1 も選べる) の目標レベルまでの全達成基準について状態を返す。criteria に達成基準ごとの状態が入る。fail は不適合、review は確認が必要な箇所あり、needs_judgment は内容を見た判断が必要、no_issue_found は自動検査の範囲で問題なし、inapplicable は対象の要素がなく該当しないと推定、manual は材料を集める手段がなく人の確認が必要。needs_judgment と review の達成基準は、collect_evidence で材料を集めて判断し、judgments に渡して再実行すると judged_pass などに変わる。conformance.verdict は、不適合があれば nonconformant、確認が残っていれば undetermined、すべて解消すれば no_failure_found になる。",
        "Runs axe-core and every check in this server, and returns a status for every WCAG 2.2 success criterion up to the target level (set wcag to audit against 2.1 instead). criteria holds the status of each one: fail is a failure, review has spots that need checking, needs_judgment requires a look at the content, no_issue_found means nothing was found within what automation covers, inapplicable means no relevant element was found so it is presumed not to apply, and manual means no material can be gathered and a person must check. For needs_judgment and review, gather material with collect_evidence, decide, and run again with judgments to turn them into judged_pass and so on. conformance.verdict is nonconformant when there is a failure, undetermined while anything is open, and no_failure_found once everything is resolved.",
      ),
      inputSchema: { ...common, level, wcag, judgments },
      annotations,
    },
    (args) => respond(() => auditPage(args)),
  );

  server.registerTool(
    "audit_site",
    {
      title: tr("複数ページにまたがる WCAG の監査", "WCAG audit across several pages"),
      description: tr(
        "複数のページを監査し、サイト全体としての達成基準ごとの状態を返す。各ページに audit_page と同じ検査を行ったうえで、ページどうしを比べて、ナビゲーションの並び順の一貫性 (3.2.3)、同じ行き先のリンク名の一貫性 (3.2.4)、タイトルの重複 (2.4.2)、ページにたどり着く手段の数 (2.4.5)、現在位置の手がかり (2.4.8)、ヘルプの位置の一貫性 (3.2.6)、同じ内容の再入力 (3.3.7) を調べる。urls を省くと、url のページにある同じサイト内のリンクを maxPages までたどる。ページ数に比例して時間がかかる。",
        "Audits several pages and returns the status of each success criterion for the site as a whole. Runs the same checks as audit_page on every page, then compares pages for consistent navigation order (3.2.3), consistent names for links to the same destination (3.2.4), duplicate titles (2.4.2), the number of ways to reach a page (2.4.5), cues for the current location (2.4.8), a consistent position for help (3.2.6) and fields that ask for the same information again (3.3.7). When urls is omitted, same-site links on the url page are followed up to maxPages. Time grows with the number of pages.",
      ),
      inputSchema: {
        ...common,
        url: z
          .string()
          .describe(tr("起点のページの URL。urls を省いたときは、このページから同じサイト内のリンクをたどる。", "URL of the start page. When urls is omitted, same-site links on this page are followed.")),
        urls: z
          .array(z.string())
          .max(20)
          .optional()
          .describe(
            tr("検査するページの URL の一覧。指定したときはリンクをたどらず、起点のページとこの一覧だけを検査する。", "URLs of the pages to audit. When given, no links are followed; only the start page and this list are audited."),
          ),
        maxPages: z.number().int().min(1).max(20).optional().describe(tr("検査するページ数の上限。既定値は 5。", "Maximum number of pages to audit. Default 5.")),
        level,
        wcag,
        judgments,
      },
      annotations,
    },
    (args) => respond(() => auditSite(args)),
  );

  return server;
}
