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
    note: "The result with a model's judgment comes from Claude, judging with the expected outcomes hidden. The judgment adds some false alarms: precision is 97.0%, against 99.4% for the automatic checks and 100% for axe-core. This is not a formal ACT implementation report.",
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
      ["audit_page", "All of WCAG 2.2 or 2.1", "Runs every other check and returns a status for each criterion"],
      ["audit_site", "All of WCAG 2.2 or 2.1", "Audits several pages and compares them for consistency"],
      ["check_axe", "Criteria covered by axe-core", "Text alternatives, contrast, labels, ARIA, language and more"],
      ["check_reflow", "1.4.4, 1.4.10", "Horizontal scrolling, overflow and clipped text at 320px and 200% zoom"],
      ["check_text_spacing", "1.4.12", "Text that is cut off or overlaps after spacing is widened"],
      ["check_keyboard_focus", "2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11, 2.4.12, 2.4.13, 3.2.1", "Focus order, focus indicators, obscured focus and keyboard traps"],
      ["check_presentation", "1.3.5, 1.4.2, 1.4.8, 2.2.2, 2.5.5, 2.5.8", "Target size, text layout, moving content and autoplaying sound"],
      ["check_interaction", "1.4.11, 1.4.13, 2.1.4, 2.3.1, 2.5.1, 2.5.2, 2.5.4, 2.5.7, 3.2.2, 3.3.8, 3.3.9, 4.1.3", "Hover content, key shortcuts, pointer and motion input, input changes, authentication and status messages"],
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
    title: "kikori: axe-core の先まで調べる WCAG 監査",
    description: "kikori は、実際にブラウザを動かして WCAG 2.2 を監査する MCP サーバーです。機械だけでは判定できない達成基準は、判断材料とスクリーンショットをコーディングエージェントに渡して判断させます。",
  },
  nav: {
    label: "メイン",
    compare: "axe-core との比較",
    how: "しくみ",
    checks: "ツール",
    start: "使い方",
    github: "GitHub",
    theme: { toDark: "ダークテーマに切り替える", toLight: "ライトテーマに切り替える" },
    skip: "本文へ移動",
  },
  hero: {
    title: "axe-core の先まで調べる WCAG 監査",
    lead: "kikori はコーディングエージェント向けの MCP サーバーです。実際にブラウザを動かして WCAG 2.2 の達成基準を 1 つずつ調べ、それぞれの結果を返します。機械だけでは判定できない達成基準は、判断材料とスクリーンショットをエージェントに渡して判断させます。",
    install: "claude mcp add kikori -- npx -y kikori",
    copy: "コマンドをコピー",
    copied: "コピーしました",
    docs: "ドキュメントを読む",
  },
  rings: {
    summary:
      "切り株の年輪になぞらえた 3 本の弧のグラフ。内側は axe-core 単体で 53.5%、中央は kikori の自動検査のみで 59.1%、外側は kikori にモデルの判断を加えた場合で 74.3%。いずれも、不適合と判定されるべき 303 件のうち報告できた割合。",
    heading: "不適合をどこまで見つけられるか",
    caption: "W3C が公開している ACT Rules のテストケースで測りました。不適合と判定されるべき 303 件のうち、実際に不適合として報告できた割合です。",
    count: (reported) => `303 件中 ${reported} 件`,
    items: [
      { key: "judged", label: "kikori にモデルの判断を加えた場合", value: 74.3, count: 225 },
      { key: "automatic", label: "kikori の自動検査のみ", value: 59.1, count: 179 },
      { key: "axe", label: "axe-core 単体", value: 53.5, count: 162 },
    ],
    note: "モデルの判断を加えた場合の結果は、正解を見せずに Claude に判断させたものです。モデルに判断させると誤検出も少し増え、適合率は 97.0% になります。自動検査のみなら 99.4%、axe-core 単体なら 100% です。なお、これは ACT の正式な実装報告ではありません。",
    noteLink: "計測方法と限界、ルールごとの結果 (英語)",
  },
  beyond: {
    heading: "HTML を読むだけでは分からないことを、操作して確かめる",
    lead: "axe-core のようなルールエンジンが調べるのは、読み込んだ時点の HTML です。kikori はそこから先、ページを実際に操作して調べます。",
    items: [
      { title: "リフローと拡大", body: "画面の幅を 320px に狭めた状態と、200% に拡大した状態で表示します。横スクロールが出ていないか、文字が途中で切れていないかを調べます。" },
      { title: "文字の間隔", body: "行間と字間を広げ、広げる前と比べます。文字が切れたり重なったりした箇所を見つけます。" },
      { title: "キーボード操作", body: "Tab キーを押してページを一巡します。フォーカスがどこにあるか見えない要素や、固定ヘッダーの裏に隠れてしまう要素、フォーカスが抜け出せなくなる箇所を見つけます。" },
      { title: "ホバーと入力", body: "ポインタを載せる、文字キーを押す、入力欄の値を変えるといった操作を試します。載せた途端に消えてしまう表示や、値を変えただけで切り替わる画面を見つけます。" },
      { title: "動き続ける表示", body: "ページを開いて 5 秒たってからの画面を何枚か撮り、見比べます。スクリプトや動画、GIF で動き続けている部分が分かります。" },
      { title: "ページどうしの比較", body: "複数のページを監査して見比べます。ナビゲーションの並び順、同じ働きをする部品の名前、ヘルプへのリンクの位置がページごとにずれていないかを確かめます。" },
    ],
  },
  how: {
    heading: "自動で調べ、残りはエージェントが判断する",
    lead: "代替テキストが画像の内容に合っているかどうかは、機械では判定できません。kikori はそうした達成基準を無理に判定せず、判断が必要なものとして残します。",
    steps: [
      { title: "ページを監査する", body: "audit_page を実行すると、すべての検査が走り、達成基準ごとに結果が 1 つ返ります。結果は fail、review、needs_judgment、no_issue_found、inapplicable、manual の 6 種類です。" },
      { title: "判断材料を集める", body: "collect_evidence は、内容を見ないと判断できない達成基準ごとに、確かめるべき問い、不適合とみなす条件、判断材料、スクリーンショットを返します。" },
      { title: "判断する。決められなければ、そう答える", body: "エージェントは判断した結果を kikori に返します。不適合と判断したときは、根拠にした箇所を添えなければなりません。根拠のない不適合の判断と「決められない」という答えは、どちらも要確認として人に引き継がれます。" },
    ],
    status: "不適合が 1 件も見つからなくても、適合している証明にはなりません。適合を表明する前に、支援技術を使って人が実際に確かめてください。",
  },
  checks: {
    heading: "用意している 10 個のツール",
    lead: "監査は 1 回でまとめて実行できます。1 か所を直している最中なら、関係する検査だけを実行することもできます。",
    caption: "kikori が提供するツール",
    columns: ["ツール", "対象の達成基準", "できること"],
    rows: [
      ["audit_page", "WCAG 2.2 または 2.1 のすべて", "ほかの検査をすべて実行し、達成基準ごとの結果を返します"],
      ["audit_site", "WCAG 2.2 または 2.1 のすべて", "複数のページを監査し、ページどうしの一貫性も比べます"],
      ["check_axe", "axe-core が扱う達成基準", "代替テキスト、コントラスト、ラベル、ARIA、言語の指定などを調べます"],
      ["check_reflow", "1.4.4、1.4.10", "幅 320px と 200% 拡大で、横スクロール、はみ出し、文字切れを調べます"],
      ["check_text_spacing", "1.4.12", "間隔を広げたときの文字切れと重なりを調べます"],
      ["check_keyboard_focus", "2.1.1、2.1.2、2.4.3、2.4.7、2.4.11、2.4.12、2.4.13、3.2.1", "フォーカスの順序と表示、隠れるフォーカス、キーボードトラップを調べます"],
      ["check_presentation", "1.3.5、1.4.2、1.4.8、2.2.2、2.5.5、2.5.8", "ターゲットの大きさ、文章の組み方、動き続ける表示、自動再生される音声を調べます"],
      ["check_interaction", "1.4.11、1.4.13、2.1.4、2.3.1、2.5.1、2.5.2、2.5.4、2.5.7、3.2.2、3.3.8、3.3.9、4.1.3", "ホバーで現れる表示、文字キーのショートカット、ポインタや端末の動きによる操作、入力時の変化、認証、ステータスメッセージを調べます"],
      ["collect_evidence", "判断が必要な達成基準", "確かめるべき問い、不適合とみなす条件、判断材料、スクリーンショットを返します"],
      ["capture_screenshot", "対象なし", "ページや要素を拡大して撮影します"],
    ],
  },
  start: {
    heading: "エージェントに追加する",
    lead: "Node.js 22 以降が必要です。検査に使うブラウザは、初回の実行時に自動でダウンロードされます。",
    tabs: [
      { id: "claude-code", label: "Claude Code", body: "次のコマンドでサーバーを登録します。あとは、開発サーバーで動いているページの監査をエージェントに頼むだけです。", code: "claude mcp add kikori -- npx -y kikori", language: "sh" },
      {
        id: "other",
        label: "ほかの MCP クライアント",
        body: "お使いのクライアントの MCP サーバー設定に、次の内容を追加します。",
        code: `{
  "mcpServers": {
    "kikori": { "command": "npx", "args": ["-y", "kikori"] }
  }
}`,
        language: "json",
      },
      { id: "skill", label: "エージェント用のスキル", body: "必須ではありません。入れておくと、監査の進め方と、結果から断定してはいけないことをエージェントが把握できます。", code: "npx skills add vivil/kikori", language: "sh" },
    ],
    options: "初期設定のままでは、kikori は localhost のページしか開きません。ほかのホストや iframe、ログインが必要なページを扱うには、起動時のオプションで許可します。",
    optionsLink: "起動時のオプション",
  },
  mobile: {
    heading: "Android アプリにも試験的に対応",
    body: "kikori-mobile は kikori とは別のパッケージで、adb 経由で Android アプリの画面を読み取ります。名前の付いていない操作部品、小さすぎるタッチターゲット、読み上げ順のずれを報告します。達成基準の番号と結果の種類は kikori と共通です。",
    link: "kikori-mobile を GitHub で見る",
  },
  footer: {
    license: "MIT ライセンスで公開しています。",
    disclaimer: "kikori は Deque Systems や axe-core とは無関係のプロジェクトです。",
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
