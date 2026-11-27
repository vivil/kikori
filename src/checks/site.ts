import { tr } from "../i18n.js";
import { auditPage, limitToLevel, summarizeCriteria, type CriterionRow, type CriterionStatus, type Judgment, type Verdict } from "./audit.js";
import { assertAllowedUrl, withPage } from "../browser.js";
import type { Level } from "../criteria.js";
import { SC, summarize, type CheckResult, type Finding } from "../types.js";

export interface SiteOptions {
  /** 起点のページ。urls を省いたときは、ここから同じサイト内のリンクをたどる。 */
  url: string;
  /** 検査するページを直接指定する。指定したときはリンクをたどらない。 */
  urls?: string[];
  /** 検査するページ数の上限。既定値は 5。 */
  maxPages?: number;
  level?: Level;
  /** サイト全体に対する判断。達成基準の一覧に反映する。 */
  judgments?: Judgment[];
  waitForSelector?: string;
  waitMs?: number;
}

interface LinkInfo {
  name: string;
  href: string;
}

interface NavInfo {
  key: string;
  selector: string;
  links: LinkInfo[];
}

export interface PageSnapshot {
  url: string;
  title: string;
  navs: NavInfo[];
  /** ヘッダー、フッター、ナビゲーションの中にある、繰り返し現れるリンク */
  repeatedLinks: LinkInfo[];
  /** 同じサイト内へのリンク先 */
  internalLinks: string[];
  hasSearch: boolean;
  hasSitemapLink: boolean;
  hasBreadcrumb: boolean;
  hasCurrentMarker: boolean;
}

export interface SiteResult {
  target: string;
  pages: { url: string; title: string; summary: { fail: number; review: number }; findings: Finding[] }[];
  conformance: { verdict: Verdict; explanation: string; counts: Record<CriterionStatus, number> };
  summary: { fail: number; review: number };
  criteria: CriterionRow[];
  beyondTarget: CriterionRow[];
  /** ページどうしを比べて見つけた指摘。selector の前に、対象のページの URL が details.page に入る。 */
  crossPage: CheckResult;
  notes?: string[];
}

const MAX_PAGES = 20;
const MAX_REPORTED = 20;

export async function auditSite(options: SiteOptions): Promise<SiteResult> {
  const level = options.level ?? "AA";
  const maxPages = Math.min(options.maxPages ?? 5, MAX_PAGES);
  const wait = { waitForSelector: options.waitForSelector, waitMs: options.waitMs };
  const notes: string[] = [];

  const snapshots: PageSnapshot[] = [];
  const first = await takeSnapshot({ url: options.url, ...wait });
  snapshots.push(first);

  let targets: string[];
  if (options.urls && options.urls.length > 0) {
    targets = unique(options.urls.map((u) => normalize(assertAllowedUrl(u).href))).filter((u) => u !== first.url);
  } else {
    targets = unique(first.internalLinks).filter((u) => u !== first.url);
  }
  if (targets.length > maxPages - 1) {
    notes.push(tr(`検査の候補は ${targets.length + 1} ページあり、上限の ${maxPages} ページだけを検査しました。maxPages か urls で対象を変えられます。`, `${targets.length + 1} candidate pages were found; only ${maxPages} were audited. Change the selection with maxPages or urls.`));
    targets = targets.slice(0, maxPages - 1);
  }
  for (const url of targets) {
    try {
      snapshots.push(await takeSnapshot({ url, ...wait }));
    } catch (error) {
      notes.push(tr(`${url} を開けなかったため、検査から外しました: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`, `${url} could not be opened and was left out: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`));
    }
  }

  const crossPage = limitToLevel(comparePages(snapshots), level);

  const perPage: CheckResult[][] = [];
  for (const snapshot of snapshots) {
    perPage.push((await auditPage({ url: snapshot.url, level, ...wait })).results);
  }

  const all = [...perPage.flat(), crossPage];
  const { criteria, beyondTarget, counts, verdict, explanation } = summarizeCriteria(all, level, options.judgments);

  return {
    target: tr(`WCAG 2.1 レベル ${level} (${snapshots.length} ページ)`, `WCAG 2.1 Level ${level} (${snapshots.length} pages)`),
    pages: snapshots.map((snapshot, i) => {
      const findings = perPage[i]!.flatMap((r) => r.findings);
      return { url: snapshot.url, title: snapshot.title, summary: summarize(findings), findings };
    }),
    conformance: { verdict, explanation, counts },
    summary: summarize(all.flatMap((r) => r.findings)),
    criteria,
    beyondTarget,
    crossPage,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** フラグメントと末尾のスラッシュの違いを無視して、同じページを同じ文字列にそろえる。 */
function normalize(href: string): string {
  const url = new URL(href);
  url.hash = "";
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
  return url.href;
}

async function takeSnapshot(options: { url: string; waitForSelector?: string | undefined; waitMs?: number | undefined }): Promise<PageSnapshot> {
  return withPage(
    {
      url: options.url,
      viewport: { width: 1280, height: 720 },
      ...(options.waitForSelector ? { waitForSelector: options.waitForSelector } : {}),
      ...(options.waitMs ? { waitMs: options.waitMs } : {}),
    },
    async (page) => {
      const raw = await page.evaluate(collectSnapshot);
      const fix = (links: LinkInfo[]): LinkInfo[] => links.map((l) => ({ ...l, href: normalize(l.href) }));
      return {
        ...raw,
        url: normalize(page.url()),
        navs: raw.navs.map((nav) => ({ ...nav, links: fix(nav.links) })),
        repeatedLinks: fix(raw.repeatedLinks),
        internalLinks: unique(raw.internalLinks.map(normalize)),
      };
    },
  );
}

/** ブラウザ側で実行する。外側の変数は参照できない。 */
function collectSnapshot(): Omit<PageSnapshot, "url"> {
  const kikori = window.__kikori;
  const SKIP_EXTENSIONS = /\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3|csv|xlsx?|docx?|pptx?)$/i;

  const nameOf = (a: HTMLAnchorElement): string => {
    const label = a.getAttribute("aria-label") ?? a.innerText ?? "";
    const alt = a.querySelector("img[alt]")?.getAttribute("alt") ?? "";
    return (label.trim() || alt).replace(/\s+/g, " ").trim();
  };
  const linksIn = (root: ParentNode): LinkInfo[] =>
    Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .filter((a) => /^(https?|file):$/.test(a.protocol) && kikori.isVisible(a))
      .map((a) => ({ name: nameOf(a), href: a.href }));

  const navElements = Array.from(document.querySelectorAll("nav, [role='navigation']"));
  const navs = navElements.map((nav, index) => {
    const labelledBy = nav.getAttribute("aria-labelledby");
    const label = nav.getAttribute("aria-label") ?? (labelledBy ? document.getElementById(labelledBy)?.textContent : null) ?? "";
    return { key: label.trim() || `nav ${index + 1}`, selector: kikori.selector(nav), links: linksIn(nav) };
  });

  const repeatedLinks = Array.from(document.querySelectorAll("nav, [role='navigation'], header, footer, [role='banner'], [role='contentinfo']")).flatMap(linksIn);

  // file: の URL はオリジンを比べられないので、同じディレクトリ以下を同じサイトとみなす。
  const base = location.href.slice(0, location.href.lastIndexOf("/") + 1);
  const sameSite = (a: HTMLAnchorElement): boolean => (location.protocol === "file:" ? a.href.startsWith(base) : a.origin === location.origin);
  const internalLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .filter((a) => /^(https?|file):$/.test(a.protocol) && sameSite(a) && !SKIP_EXTENSIONS.test(a.pathname) && !a.hasAttribute("download"))
    .map((a) => a.href);

  const breadcrumb = navElements.some((nav) => /パンくず|breadcrumb/i.test(`${nav.getAttribute("aria-label") ?? ""} ${nav.className}`));
  return {
    title: document.title.trim(),
    navs,
    repeatedLinks,
    internalLinks,
    hasSearch: document.querySelector("[role='search'], search, input[type='search']") !== null,
    hasSitemapLink: Array.from(document.querySelectorAll("a[href]")).some((a) => /サイトマップ|sitemap/i.test(`${a.textContent ?? ""} ${a.getAttribute("href") ?? ""}`)),
    hasBreadcrumb: breadcrumb,
    hasCurrentMarker: document.querySelector("[aria-current='page']") !== null,
  };
}

/** ページどうしを比べ、サイト全体にかかわる達成基準を調べる。 */
export function comparePages(pages: PageSnapshot[]): CheckResult {
  const findings: Finding[] = [];
  const checked: string[] = [];
  const notes: string[] = [];
  const base: Omit<CheckResult, "summary" | "findings" | "checked"> = {
    check: "cross_page",
    url: pages[0]?.url ?? "",
    viewport: { width: 1280, height: 720 },
  };

  if (pages.length < 2) {
    notes.push(tr("検査できたページが 1 つだけだったため、ページどうしの比較は行っていません。", "Only one page could be audited, so pages were not compared with each other."));
    return { ...base, summary: summarize(findings), findings, checked, notes };
  }

  // 3.2.3: 同じナビゲーションの中で、共通する項目の並び順がページによって変わらないか。
  const firstSeen = new Map<string, { page: PageSnapshot; nav: NavInfo }>();
  let comparedNavs = 0;
  for (const page of pages) {
    for (const nav of page.navs) {
      if (nav.links.length === 0) continue;
      const reference = firstSeen.get(nav.key);
      if (!reference) {
        firstSeen.set(nav.key, { page, nav });
        continue;
      }
      comparedNavs++;
      const here = unique(nav.links.map((l) => l.href));
      const there = unique(reference.nav.links.map((l) => l.href));
      const commonHere = here.filter((href) => there.includes(href));
      const commonThere = there.filter((href) => here.includes(href));
      if (commonHere.length >= 2 && commonHere.join("\n") !== commonThere.join("\n")) {
        const names = (hrefs: string[], links: LinkInfo[]): string[] => hrefs.map((href) => links.find((l) => l.href === href)?.name || href);
        findings.push({
          sc: SC.consistentNavigation,
          severity: "fail",
          selector: nav.selector,
          message: tr(`ナビゲーション「${nav.key}」の項目の並び順が、${reference.page.url} と違います。同じ項目はどのページでも同じ順序で並べてください。`, `The items of navigation "${nav.key}" are in a different order than on ${reference.page.url}. Keep the same items in the same order on every page.`),
          details: { page: page.url, order: names(commonHere, nav.links), comparedWith: reference.page.url, expectedOrder: names(commonThere, reference.nav.links) },
        });
      }
    }
  }
  if (comparedNavs > 0) checked.push("3.2.3");
  else notes.push(tr("複数のページに共通するナビゲーション (nav 要素) が見つからなかったため、3.2.3 は検査していません。", "No navigation (nav element) shared by several pages was found, so 3.2.3 was not checked."));

  // 3.2.4: 繰り返し現れるリンクのうち、同じ行き先なのに名前が違うものがないか。
  const namesByHref = new Map<string, Map<string, string>>();
  for (const page of pages) {
    for (const link of page.repeatedLinks) {
      if (!link.name) continue;
      const names = namesByHref.get(link.href) ?? new Map<string, string>();
      if (!names.has(link.name)) names.set(link.name, page.url);
      namesByHref.set(link.href, names);
    }
  }
  if (namesByHref.size > 0) checked.push("3.2.4");
  let inconsistent = 0;
  for (const [href, names] of namesByHref) {
    if (names.size < 2 || inconsistent++ >= MAX_REPORTED) continue;
    const list = [...names].map(([name, page]) => ({ name, page }));
    findings.push({
      sc: SC.consistentIdentification,
      severity: "review",
      selector: `a[href]`,
      message: tr(`同じ行き先 (${href}) へのリンクに、${list.map((n) => `「${n.name}」`).join("と")}という違う名前が付いています。同じ機能には同じ名前を使っているか確認してください。`, `Links to the same destination (${href}) have different names: ${list.map((n) => `"${n.name}"`).join(", ")}. Check that the same function is given the same name.`),
      details: { href, names: list },
    });
  }

  // 2.4.2: 違うページに同じタイトルが付いていないか。
  checked.push("2.4.2");
  const pagesByTitle = new Map<string, string[]>();
  for (const page of pages) pagesByTitle.set(page.title, [...(pagesByTitle.get(page.title) ?? []), page.url]);
  for (const [title, urls] of pagesByTitle) {
    if (urls.length < 2) continue;
    findings.push({
      sc: SC.pageTitled,
      severity: title === "" ? "fail" : "review",
      selector: "title",
      message:
        title === ""
          ? tr(`${urls.length} ページにタイトルがありません。`, `${urls.length} pages have no title.`)
          : tr(`${urls.length} ページに同じタイトル「${title}」が付いています。ページごとの主題が分かるタイトルにしてください。`, `${urls.length} pages share the title "${title}". Give each page a title that describes its topic.`),
      details: { title, pages: urls },
    });
  }

  // 2.4.5: ページにたどり着く手段が 2 つ以上あるか。
  checked.push("2.4.5");
  for (const page of pages) {
    const ways = [
      ...(page.navs.some((nav) => nav.links.length > 0) ? [tr("ナビゲーション", "navigation")] : []),
      ...(page.hasSearch ? [tr("サイト内検索", "site search")] : []),
      ...(page.hasSitemapLink ? [tr("サイトマップ", "a sitemap")] : []),
    ];
    if (ways.length >= 2) continue;
    findings.push({
      sc: SC.multipleWays,
      severity: "review",
      selector: "html",
      message: tr(`ほかのページを見つける手段が ${ways.length === 0 ? "見つかりませんでした" : `${ways[0]}だけです`}。検索、サイトマップ、目次などを加えて 2 つ以上にするか、手順の途中のページで例外にあたるかを確認してください。`, `${ways.length === 0 ? "No way to find other pages was found" : `The only way to find other pages is ${ways[0]}`}. Add search, a sitemap or a table of contents so there are at least two, or confirm that the page is a step in a process and therefore exempt.`),
      details: { page: page.url, ways },
    });
  }

  // 2.4.8 (AAA): サイトの中での現在位置が分かるか。
  checked.push("2.4.8");
  for (const page of pages) {
    if (page.hasBreadcrumb || page.hasCurrentMarker) continue;
    findings.push({
      sc: SC.location,
      severity: "review",
      selector: "html",
      message: tr("パンくずリストも aria-current=\"page\" の指定も見つかりませんでした。サイトの中での現在位置が分かる手がかりがあるか確認してください。", "Neither a breadcrumb trail nor aria-current=\"page\" was found. Check that there is a cue for the current location within the site."),
      details: { page: page.url },
    });
  }

  return { ...base, summary: summarize(findings), findings, checked, data: { pages: pages.map((p) => p.url) }, ...(notes.length > 0 ? { notes } : {}) };
}
