export type Locale = "en" | "ja";

export interface Ring {
  key: "judged" | "automatic" | "axe";
  label: string;
  value: number;
  count: number;
}

export interface Content {
  locale: Locale;
  otherLocale: { label: string; href: string; lang: Locale };
  meta: { title: string; description: string };
  nav: { label: string; compare: string; how: string; checks: string; start: string; github: string; theme: { toDark: string; toLight: string }; skip: string };
  hero: { title: string; lead: string; install: string; copy: string; copied: string; docs: string };
  rings: { summary: string; heading: string; caption: string; items: Ring[]; count: (reported: number) => string; note: string; noteLink: string };
  beyond: { heading: string; lead: string; items: { title: string; body: string }[] };
  how: { heading: string; lead: string; steps: { title: string; body: string }[]; status: string };
  checks: { heading: string; lead: string; caption: string; columns: [string, string, string]; rows: [string, string, string][] };
  start: { heading: string; lead: string; tabs: { id: string; label: string; body: string; code: string; language: string }[]; options: string; optionsLink: string };
  mobile: { heading: string; body: string; link: string };
  footer: { license: string; disclaimer: string; npm: string; github: string; issues: string };
}

const REPO = "https://github.com/vivil/kikori";

const en: Content = {
  locale: "en",
  otherLocale: { label: "日本語", href: "ja/", lang: "ja" },
  meta: {
    title: "kikori: WCAG audits that go past what axe-core can check",
    description: "kikori is an MCP server that audits WCAG 2.2 in a real browser and hands the criteria that need judgment to your coding agent, with evidence and screenshots.",
  },
  nav: {
    label: "Main",
    compare: "Compared with axe-core",
    how: "How it works",
    checks: "What it checks",
    start: "Get started",
    github: "GitHub",
    theme: { toDark: "Switch to dark theme", toLight: "Switch to light theme" },
    skip: "Skip to main content",
  },
  hero: {
    title: "WCAG audits that go past what axe-core can check",
    lead: "kikori is an MCP server for coding agents. It drives a real browser, reports a status for every WCAG 2.2 success criterion, and hands the ones that need judgment to the agent with evidence and screenshots.",
    install: "claude mcp add kikori -- npx -y kikori",
    copy: "Copy command",
    copied: "Copied",
    docs: "Read the documentation",
  },
  rings: {
    summary:
      "Three growth rings of a tree stump, drawn as arcs. Inner ring: axe-core alone reports 53.5% of the expected failures. Middle ring: kikori's automatic checks report 59.1%. Outer ring: kikori with a model's judgment reports 74.3%.",
    heading: "How much of what should fail gets reported",
    caption: "Expected failures reported, out of 303, on the W3C ACT Rules test cases.",
    count: (reported) => `${reported} of 303`,
    items: [
      { key: "judged", label: "kikori with a model's judgment", value: 74.3, count: 225 },
      { key: "automatic", label: "kikori, automatic checks", value: 59.1, count: 179 },
      { key: "axe", label: "axe-core alone", value: 53.5, count: 162 },
    ],
    note: "For the outer ring Claude was the judging model, with the expected outcomes hidden. It adds some false alarms: precision is 97.0%, against 99.4% for the automatic checks and 100% for axe-core. This is not a formal ACT implementation report.",
    noteLink: "Method, limits and per-rule numbers",
  },
  beyond: {
    heading: "Checks that need a browser, not just markup",
    lead: "A rule engine reads the page as it was loaded. kikori also operates it.",
    items: [
      { title: "Reflow and zoom", body: "Renders at 320px wide and at 200% zoom, then looks for horizontal scrolling and clipped text." },
      { title: "Text spacing", body: "Widens line height and letter spacing, and compares before and after for text that gets cut off or overlaps." },
      { title: "Keyboard focus", body: "Presses Tab through the page. Finds missing focus indicators, elements hidden under a fixed header, and focus that cannot leave." },
      { title: "Hover and input", body: "Hovers, types character keys and changes field values to find content that vanishes or pages that jump." },
      { title: "Moving content", body: "Compares screenshots after five seconds to catch motion from scripts, videos and GIFs." },
      { title: "Across pages", body: "Audits several pages and compares navigation, naming and help links for consistency." },
    ],
  },
  how: {
    heading: "Automatic checks first, then the agent judges",
    lead: "Whether a text alternative fits its image cannot be decided mechanically. kikori does not pretend it can.",
    steps: [
      { title: "Audit the page", body: "audit_page runs every check and returns one status per success criterion: fail, review, needs_judgment, no_issue_found, inapplicable or manual." },
      { title: "Collect the evidence", body: "For criteria that need a look at the content, collect_evidence returns the question to answer, the failure condition, the evidence and a screenshot." },
      { title: "Judge, and say when you cannot", body: "The agent passes its judgments back. A failure has to name the evidence it relies on. Without it, or when the agent answers unsure, the criterion goes to a person as a review item." },
    ],
    status: "A result with no failures is not proof of conformance. Have a person verify with assistive technology before claiming it.",
  },
  checks: {
    heading: "Ten tools, one status per success criterion",
    lead: "Run the whole audit, or one check while you fix one thing.",
    caption: "The tools kikori provides",
    columns: ["Tool", "Success criteria", "What it does"],
    rows: [
      ["audit_page", "All of WCAG 2.2 or 2.1", "Runs every check below and returns a status for each criterion"],
      ["audit_site", "All of WCAG 2.2 or 2.1", "Audits several pages and compares them for consistency"],
      ["check_axe", "Criteria covered by axe-core", "Text alternatives, contrast, labels, ARIA, language and more"],
      ["check_reflow", "1.4.4, 1.4.10", "Horizontal scrolling, overflow and clipped text at 320px and 200% zoom"],
      ["check_text_spacing", "1.4.12", "Text that is cut off or overlaps after spacing is widened"],
      ["check_keyboard_focus", "2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11 to 2.4.13, 3.2.1", "Focus order, focus indicators, obscured focus and keyboard traps"],
      ["check_presentation", "1.3.5, 1.4.2, 1.4.8, 2.2.2, 2.5.5, 2.5.8", "Target size, text layout, moving content and autoplaying sound"],
      ["check_interaction", "1.4.13, 2.1.4, 2.5.x, 3.2.2, 3.3.8, 4.1.3 and more", "Hover content, key shortcuts, input changes and status messages"],
      ["collect_evidence", "Criteria that need judgment", "The question, the failure condition, the evidence and a screenshot"],
      ["capture_screenshot", "None", "A closer look at the page or one element"],
    ],
  },
  start: {
    heading: "Add it to your agent",
    lead: "You need Node.js 22 or later. The browser is downloaded on first use.",
    tabs: [
      { id: "claude-code", label: "Claude Code", body: "Register the server, then ask the agent to audit a page on your dev server.", code: "claude mcp add kikori -- npx -y kikori", language: "sh" },
      {
        id: "other",
        label: "Other MCP clients",
        body: "Add kikori to the client's MCP server settings.",
        code: `{
  "mcpServers": {
    "kikori": { "command": "npx", "args": ["-y", "kikori"] }
  }
}`,
        language: "json",
      },
      { id: "skill", label: "Agent skill", body: "Optional. Teaches the agent how to run an audit and what it must not claim.", code: "npx skills add vivil/kikori", language: "sh" },
    ],
    options: "By default kikori only opens pages on localhost. Other hosts, iframes and logged-in pages are opt-in.",
    optionsLink: "Startup options",
  },
  mobile: {
    heading: "Android apps, experimentally",
    body: "kikori-mobile is a separate package that reads the screen of an Android app through adb. It reports unnamed controls, small touch targets and reading-order mismatches, with the same criterion numbers and statuses.",
    link: "kikori-mobile on GitHub",
  },
  footer: {
    license: "MIT licensed.",
    disclaimer: "kikori is not affiliated with Deque Systems or axe-core.",
    npm: "npm",
    github: "GitHub",
    issues: "Report an issue",
  },
};

const ja: Content = {
  locale: "ja",
  otherLocale: { label: "English", href: "../", lang: "en" },
  meta: {
    title: "kikori: axe-core では調べられない先まで、WCAG を監査する",
    description: "kikori は、実際のブラウザで WCAG 2.2 を監査する MCP サーバーです。判断が要る達成基準は、判断材料とスクリーンショットを添えて、コーディングエージェントに渡します。",
  },
  nav: {
    label: "メイン",
    compare: "axe-core との比較",
    how: "しくみ",
    checks: "検査できること",
    start: "使い方",
    github: "GitHub",
    theme: { toDark: "ダークテーマに切り替える", toLight: "ライトテーマに切り替える" },
    skip: "本文へ移動",
  },
  hero: {
    title: "axe-core では調べられない先まで、WCAG を監査する",
    lead: "kikori は、コーディングエージェントのための MCP サーバーです。実際のブラウザを操作して、WCAG 2.2 のすべての達成基準に状態を付けます。判断が要る達成基準は、判断材料とスクリーンショットを添えてエージェントに渡します。",
    install: "claude mcp add kikori -- npx -y kikori",
    copy: "コマンドをコピー",
    copied: "コピーしました",
    docs: "ドキュメントを読む",
  },
  rings: {
    summary:
      "切り株の年輪を 3 本の弧で表した図。内側の輪は axe-core 単体で、期待される不適合の 53.5% を報告。中央の輪は kikori の自動検査で 59.1%。外側の輪は kikori とモデルの判断で 74.3%。",
    heading: "不適合のうち、どれだけを報告できるか",
    caption: "W3C の ACT Rules のテストケースで、期待される不適合 303 件のうち報告できた件数。",
    count: (reported) => `303 件中 ${reported} 件`,
    items: [
      { key: "judged", label: "kikori とモデルの判断", value: 74.3, count: 225 },
      { key: "automatic", label: "kikori の自動検査", value: 59.1, count: 179 },
      { key: "axe", label: "axe-core 単体", value: 53.5, count: 162 },
    ],
    note: "外側の輪は、Claude が期待される結果を伏せた状態で判断したものです。誤検出が少し増えます。適合率は 97.0% で、自動検査は 99.4%、axe-core は 100% です。正式な ACT の実装報告ではありません。",
    noteLink: "計測の方法、限界、ルールごとの数字 (英語)",
  },
  beyond: {
    heading: "マークアップを読むだけでは分からないことを、ブラウザで確かめる",
    lead: "ルールエンジンは、読み込んだ時点のページを調べます。kikori は、ページを実際に操作します。",
    items: [
      { title: "リフローと拡大", body: "幅 320px と 200% の拡大で表示し、横スクロールと切れた文字を探します。" },
      { title: "文字の間隔", body: "行の高さと字間を広げ、その前後を比べて、切れた文字や重なった文字を探します。" },
      { title: "キーボードのフォーカス", body: "Tab キーでページを一巡します。フォーカス表示のない要素、固定ヘッダーに隠れる要素、抜け出せない箇所を見つけます。" },
      { title: "ホバーと入力", body: "ポインタを載せ、文字キーを押し、入力欄の値を変えて、消えてしまう内容や勝手に移動するページを見つけます。" },
      { title: "動き続ける内容", body: "5 秒後の画面を撮り比べて、スクリプト、動画、GIF による動きを拾います。" },
      { title: "ページをまたいだ比較", body: "複数のページを監査し、ナビゲーション、名前の付け方、ヘルプへのリンクが一貫しているかを比べます。" },
    ],
  },
  how: {
    heading: "まず自動で検査し、そのあとエージェントが判断する",
    lead: "代替テキストが画像に合っているかは、機械的には決められません。kikori は、決められるふりをしません。",
    steps: [
      { title: "ページを監査する", body: "audit_page がすべての検査を実行し、達成基準ごとに 1 つの状態を返します。状態は fail、review、needs_judgment、no_issue_found、inapplicable、manual のいずれかです。" },
      { title: "判断材料を集める", body: "内容を見た判断が要る達成基準について、collect_evidence が、答えるべき問い、不適合とする条件、判断材料、スクリーンショットを返します。" },
      { title: "判断し、決められないときはそう答える", body: "エージェントが判断を返します。不適合とする判断には、根拠の箇所を示す必要があります。根拠がない場合と、決められないと答えた場合は、要確認として人に引き継ぎます。" },
    ],
    status: "不適合が 1 件もない結果は、適合の証明ではありません。適合を表明する前に、支援技術を使った人による確認を行ってください。",
  },
  checks: {
    heading: "10 個のツールで、達成基準ごとに 1 つの状態を返す",
    lead: "監査全体を実行することも、1 か所を直す間に 1 つの検査だけを実行することもできます。",
    caption: "kikori が提供するツール",
    columns: ["ツール", "達成基準", "内容"],
    rows: [
      ["audit_page", "WCAG 2.2 または 2.1 の全体", "下のすべての検査を実行し、達成基準ごとの状態を返します"],
      ["audit_site", "WCAG 2.2 または 2.1 の全体", "複数のページを監査し、一貫性を比べます"],
      ["check_axe", "axe-core が扱う達成基準", "代替テキスト、コントラスト、ラベル、ARIA、言語の指定など"],
      ["check_reflow", "1.4.4、1.4.10", "幅 320px と 200% の拡大での横スクロール、はみ出し、切れた文字"],
      ["check_text_spacing", "1.4.12", "間隔を広げたときに切れる文字と重なる文字"],
      ["check_keyboard_focus", "2.1.1、2.1.2、2.4.3、2.4.7、2.4.11 から 2.4.13、3.2.1", "フォーカスの順序、フォーカス表示、隠れるフォーカス、キーボードの罠"],
      ["check_presentation", "1.3.5、1.4.2、1.4.8、2.2.2、2.5.5、2.5.8", "ターゲットの大きさ、文章の体裁、動き続ける内容、自動再生の音声"],
      ["check_interaction", "1.4.13、2.1.4、2.5.x、3.2.2、3.3.8、4.1.3 など", "ホバーで現れる内容、キーのショートカット、入力時の変化、ステータスメッセージ"],
      ["collect_evidence", "判断が要る達成基準", "問い、不適合とする条件、判断材料、スクリーンショット"],
      ["capture_screenshot", "なし", "ページや要素の拡大"],
    ],
  },
  start: {
    heading: "エージェントに追加する",
    lead: "Node.js 22 以降が必要です。ブラウザは、最初に使うときにダウンロードされます。",
    tabs: [
      { id: "claude-code", label: "Claude Code", body: "サーバーを登録してから、開発サーバーのページの監査をエージェントに頼みます。", code: "claude mcp add kikori -- npx -y kikori", language: "sh" },
      {
        id: "other",
        label: "ほかの MCP クライアント",
        body: "クライアントの MCP サーバーの設定に、kikori を追加します。",
        code: `{
  "mcpServers": {
    "kikori": { "command": "npx", "args": ["-y", "kikori"] }
  }
}`,
        language: "json",
      },
      { id: "skill", label: "エージェントのスキル", body: "任意です。監査の進め方と、主張してはいけないことをエージェントに教えます。", code: "npx skills add vivil/kikori", language: "sh" },
    ],
    options: "既定では、kikori は localhost のページだけを開きます。ほかのホスト、iframe、ログインが要るページは、明示的に許可したときだけ扱います。",
    optionsLink: "起動時のオプション",
  },
  mobile: {
    heading: "Android のアプリにも、試験的に対応",
    body: "kikori-mobile は、adb を通して Android のアプリの画面を読み取る、別のパッケージです。名前のない操作部品、小さいタッチターゲット、読み上げ順の食い違いを報告します。達成基準の番号と状態は、kikori と共通です。",
    link: "GitHub の kikori-mobile",
  },
  footer: {
    license: "MIT ライセンスです。",
    disclaimer: "kikori は、Deque Systems および axe-core とは関係がありません。",
    npm: "npm",
    github: "GitHub",
    issues: "不具合を報告する",
  },
};

export const CONTENT: Record<Locale, Content> = { en, ja };

export const LINKS = {
  repo: REPO,
  readme: (locale: Locale) => (locale === "ja" ? `${REPO}/blob/main/README.ja.md` : `${REPO}#readme`),
  options: (locale: Locale) => (locale === "ja" ? `${REPO}/blob/main/README.ja.md#起動時のオプション` : `${REPO}#startup-options`),
  results: `${REPO}/blob/main/docs/act-results.md`,
  mobile: (locale: Locale) => (locale === "ja" ? `${REPO}/blob/main/packages/mobile/README.ja.md` : `${REPO}/tree/main/packages/mobile#readme`),
  npm: "https://www.npmjs.com/package/kikori",
  issues: `${REPO}/issues`,
};
