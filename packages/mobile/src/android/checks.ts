import { criterion } from "../../../core/src/criteria.js";
import { tr } from "../../../core/src/i18n.js";
import { summarize, type CheckResult, type Finding } from "../../../core/src/types.js";
import type { Device } from "./device.js";
import { flatten, parseHierarchy, type Bounds, type UiNode } from "./tree.js";

const NON_TEXT_CONTENT = criterion("1.1.1");
const MEANINGFUL_SEQUENCE = criterion("1.3.2");
const TARGET_SIZE = criterion("2.5.5");
const TARGET_SIZE_MINIMUM = criterion("2.5.8");
const NAME_ROLE_VALUE = criterion("4.1.2");

/** Android の指針が勧める、タッチターゲットの大きさ (dp) */
const PLATFORM_TARGET_DP = 48;
const MAX_REPORTED = 30;

const width = (b: Bounds): number => b.right - b.left;
const height = (b: Bounds): number => b.bottom - b.top;
const shown = (node: UiNode): boolean => width(node.bounds) > 0 && height(node.bounds) > 0;
const simpleClass = (node: UiNode): string => node.className.split(".").pop() || "View";
const isImage = (node: UiNode): boolean => /Image(View|Button)$/.test(node.className);
const actionable = (node: UiNode): boolean => node.enabled && shown(node) && (node.clickable || node.longClickable || node.checkable);
const ownLabel = (node: UiNode): string => node.text || node.contentDesc || node.hint;

/** スクリーンリーダーが読む名前の見積もり。自分に文言がなければ、子孫の文言をつなぐ。 */
function label(node: UiNode): string {
  const own = ownLabel(node);
  if (own) return own;
  return node.children.map(label).filter(Boolean).join(" ");
}

/** 指摘の中で要素を指す書き方。resource-id があればそれを、なければクラス名と位置を使う。 */
function describe(node: UiNode): string {
  const b = node.bounds;
  const id = node.resourceId.split("/").pop();
  return `${id ? `#${id}` : simpleClass(node)} [${b.left},${b.top}][${b.right},${b.bottom}]`;
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** 中心を保ったまま、一辺が size px 以上になるように広げた範囲 */
function expanded(b: Bounds, size: number): Bounds {
  const growX = Math.max(0, size - width(b)) / 2;
  const growY = Math.max(0, size - height(b)) / 2;
  return { left: b.left - growX, right: b.right + growX, top: b.top - growY, bottom: b.bottom + growY };
}

export interface AndroidScreen {
  packageName: string;
  density: number;
  nodes: UiNode[];
}

/** 画面の階層から、機械的に分かる不備を拾う。端末には触れない。 */
export function inspectScreen(screen: AndroidScreen): CheckResult {
  const { nodes, density } = screen;
  const dp = (px: number): number => Math.round((px * 160) / density);
  const px = (value: number): number => (value * density) / 160;
  const findings: Finding[] = [];
  const targets = nodes.filter(actionable);

  // 1. 名前のない操作部品
  for (const node of targets) {
    if (label(node)) continue;
    const image = isImage(node) || (node.children.length > 0 && flatten(node.children).every((child) => isImage(child) || child.children.length > 0));
    findings.push({
      sc: image ? NON_TEXT_CONTENT : NAME_ROLE_VALUE,
      severity: "fail",
      selector: describe(node),
      message: tr(
        `操作できる ${simpleClass(node)} に、読み上げられる名前がありません。contentDescription か文言を付けてください。`,
        `This actionable ${simpleClass(node)} has no name for a screen reader. Give it a contentDescription or text.`,
      ),
      details: { class: node.className, resourceId: node.resourceId || null },
    });
  }

  // 2. タッチターゲットの大きさ
  const belowPlatform: { selector: string; size: string }[] = [];
  const framework = detectFramework(nodes);
  const scrollable = nodes.filter((node) => node.scrollable && shown(node));
  for (const node of targets) {
    const w = dp(width(node.bounds));
    const h = dp(height(node.bounds));
    const size = `${w}x${h}dp`;
    if (w < 24 || h < 24) {
      // 2.5.8 は、24px の範囲がほかのターゲットと重ならなければ、小さくても認める。
      const own = expanded(node.bounds, px(24));
      const crowded = targets.some((other) => other !== node && !isAncestor(other, node) && !isAncestor(node, other) && intersects(own, expanded(other.bounds, px(24))));
      if (crowded) {
        // 文の中に置かれたターゲットは、2.5.8 の例外にあたることがある。言い切らずに要確認にする。
        const inline = inTextLine(node);
        findings.push({
          sc: TARGET_SIZE_MINIMUM,
          severity: inline ? "review" : "fail",
          selector: describe(node),
          message: inline
            ? tr(
                `タッチターゲットが ${size} で、24dp に届かず、隣のターゲットとの間隔も足りません。文の中のリンクであれば例外にあたるので、確認してください。`,
                `The touch target is ${size}: smaller than 24dp and too close to a neighbouring target. If it is a link inside a sentence, the inline exception applies, so check it.`,
              )
            : tr(`タッチターゲットが ${size} で、24dp に届かず、隣のターゲットとの間隔も足りません。`, `The touch target is ${size}: smaller than 24dp and too close to a neighbouring target.`),
          details: { width: w, height: h },
        });
      }
    }
    if (w < 44 || h < 44) {
      findings.push({
        sc: TARGET_SIZE,
        severity: "fail",
        selector: describe(node),
        message: tr(`タッチターゲットが ${size} で、44dp に届きません。`, `The touch target is ${size}, smaller than 44dp.`),
        details: { width: w, height: h },
      });
    } else if (w < PLATFORM_TARGET_DP || h < PLATFORM_TARGET_DP) {
      belowPlatform.push({ selector: describe(node), size });
    }
  }

  // 3. 読み上げの順序。階層に書かれた順に、読み上げの単位になる要素を並べる。
  const stops = nodes.filter((node) => shown(node) && (actionable(node) || (ownLabel(node) !== "" && !hasActionableAncestor(node))));
  let orderFindings = 0;
  for (let i = 1; i < stops.length && orderFindings < 15; i++) {
    const prev = stops[i - 1]!;
    const cur = stops[i]!;
    if (isAncestor(prev, cur) || isAncestor(cur, prev)) continue;
    if (cur.bounds.bottom <= prev.bounds.top - px(8)) {
      orderFindings++;
      findings.push({
        sc: MEANINGFUL_SEQUENCE,
        severity: "review",
        selector: describe(cur),
        message: tr(
          `「${label(cur).slice(0, 30)}」は、階層では「${label(prev).slice(0, 30)}」の後にありますが、画面では上に表示されています。読み上げの順序で意味が通るか確認してください。`,
          `"${label(cur).slice(0, 30)}" comes after "${label(prev).slice(0, 30)}" in the hierarchy but is shown above it. Check that the reading order still makes sense.`,
        ),
        details: { before: describe(prev) },
      });
    }
  }

  const unnamedImages = nodes.filter((node) => isImage(node) && shown(node) && !actionable(node) && !hasActionableAncestor(node) && !ownLabel(node));
  const root = nodes[0];
  const notes: string[] = [];
  if (belowPlatform.length > 0) {
    notes.push(
      tr(
        `${belowPlatform.length} 件のタッチターゲットは 44dp 以上ですが、Android の指針が勧める ${PLATFORM_TARGET_DP}dp に届いていません。data.platformGuidelines に一覧があります。`,
        `${belowPlatform.length} touch targets are at least 44dp but below the ${PLATFORM_TARGET_DP}dp that the Android guidelines recommend. They are listed in data.platformGuidelines.`,
      ),
    );
  }
  if (scrollable.length > 0) {
    notes.push(
      tr(
        `スクロールできる領域が ${scrollable.length} 個あります。画面の外にある項目は階層に現れないので、検査していません。スクロールしてから、もう一度検査してください。`,
        `There are ${scrollable.length} scrollable areas. Items outside the screen do not appear in the hierarchy and were not checked. Scroll and run the check again.`,
      ),
    );
  }
  if (framework.readingOrderConfidence === "lower") {
    notes.push(
      tr(
        `${framework.detected.join("、")} で作られた画面のようです。読み上げの順序はフレームワークが独自に決めるので、階層からの見積もりは外れやすくなります。1.3.2 の指摘と readingOrder は、参考として扱ってください。`,
        `This screen appears to be built with ${framework.detected.join(", ")}. The framework decides the reading order itself, so the estimate from the hierarchy is less reliable. Treat the 1.3.2 findings and readingOrder as hints.`,
      ),
    );
  }
  notes.push(
    tr(
      "検査したのは、いま表示されている画面だけです。WebView の中身は含まれないことがあります。",
      "Only the screen currently shown was checked. The inside of a WebView may be missing.",
    ),
  );

  return {
    check: "android_screen",
    url: `android://${screen.packageName}`,
    viewport: { width: dp(root ? width(root.bounds) : 0), height: dp(root ? height(root.bounds) : 0) },
    summary: summarize(findings),
    findings: findings.slice(0, MAX_REPORTED * 3),
    checked: ["1.1.1", "1.3.2", "2.5.5", "2.5.8", "4.1.2"],
    needsJudgment: [...(unnamedImages.length > 0 ? ["1.1.1"] : []), "1.3.2"],
    data: {
      density,
      framework,
      scrollableAreas: scrollable.slice(0, 10).map(describe),
      // 読み上げの順序が意味の通るものかは、この一覧を見て判断する。
      readingOrder: stops.slice(0, 80).map((node) => ({ selector: describe(node), class: simpleClass(node), label: label(node).slice(0, 60), actionable: actionable(node) })),
      // 装飾かどうかを機械的には決められない、名前のない画像。
      unnamedImages: unnamedImages.slice(0, MAX_REPORTED).map(describe),
      // WCAG の達成基準ではなく、プラットフォームの指針に届かないもの。
      platformGuidelines: [
        {
          platform: "android",
          guideline: tr(`タッチターゲットは ${PLATFORM_TARGET_DP}dp 以上にする`, `Touch targets should be at least ${PLATFORM_TARGET_DP}dp`),
          source: "https://developer.android.com/guide/topics/ui/accessibility/apps",
          items: belowPlatform.slice(0, MAX_REPORTED),
        },
      ],
    },
    notes,
  };
}

/** 同じ行に、操作できない文章が並んでいるか。文の中のリンクを見分ける目安にする。 */
function inTextLine(node: UiNode): boolean {
  if (!/TextView$/.test(node.className)) return false;
  return (node.parent?.children ?? []).some(
    (sibling) => sibling !== node && !actionable(sibling) && sibling.text !== "" && sibling.bounds.top < node.bounds.bottom && node.bounds.top < sibling.bounds.bottom,
  );
}

export interface FrameworkGuess {
  detected: string[];
  /** 階層の順序を、読み上げの順序の見積もりとしてどの程度あてにできるか */
  readingOrderConfidence: "higher" | "lower";
}

/** 階層に現れるクラス名から、画面を作っているフレームワークを推定する。 */
function detectFramework(nodes: UiNode[]): FrameworkGuess {
  const SIGNS: [RegExp, string][] = [
    [/^androidx\.compose\./, "Jetpack Compose"],
    [/^io\.flutter\./, "Flutter"],
    [/^com\.facebook\.react\./, "React Native"],
    [/^android\.webkit\.WebView$/, "WebView"],
  ];
  const detected = SIGNS.filter(([pattern]) => nodes.some((node) => pattern.test(node.className))).map(([, name]) => name);
  // 標準の View では、読み上げの順序は階層の順序に近い。それ以外は、独自の決め方をする。
  return { detected: detected.length > 0 ? detected : ["Android View"], readingOrderConfidence: detected.length > 0 ? "lower" : "higher" };
}

function isAncestor(ancestor: UiNode, node: UiNode): boolean {
  for (let cur = node.parent; cur; cur = cur.parent) if (cur === ancestor) return true;
  return false;
}

function hasActionableAncestor(node: UiNode): boolean {
  for (let cur = node.parent; cur; cur = cur.parent) if (actionable(cur)) return true;
  return false;
}

/** 端末から画面の階層と密度を読み、検査する。 */
export async function checkAndroidScreen(device: Device): Promise<CheckResult> {
  const [xml, density] = [await device.hierarchy(), await device.density()];
  const all = flatten(parseHierarchy(xml));
  // ステータスバーなど、システムの画面部品は検査の対象にしない。
  const packageName = mostCommonPackage(all);
  const nodes = all.filter((node) => node.packageName === packageName);
  if (nodes.length === 0) throw new Error(tr("画面に検査できる要素がありません。", "The screen has no elements to check."));
  return inspectScreen({ packageName, density, nodes });
}

function mostCommonPackage(nodes: UiNode[]): string {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (node.packageName === "com.android.systemui") continue;
    counts.set(node.packageName, (counts.get(node.packageName) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}
