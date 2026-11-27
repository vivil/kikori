import { tr } from "./i18n.js";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { getSettings, isFrameHostAllowed, isHostAllowed } from "./config.js";
import { installHelpers } from "./helpers.js";

export interface PageOptions {
  url: string;
  viewport: { width: number; height: number };
  /** 読み込み後、この要素が現れるまで待つ */
  waitForSelector?: string;
  /** 読み込み後に追加で待つ時間 (ミリ秒) */
  waitMs?: number;
  timeoutMs?: number;
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "file:"]);

const HTML_EXTENSIONS = new Set([".html", ".htm", ".xhtml"]);

/** file: の URL で開いてよいディレクトリ。既定では、サーバーを起動したディレクトリ。 */
function fileRoot(): string {
  return realpathSync(getSettings().fileRoot ?? process.cwd());
}

/**
 * 検査結果には画面の画像や文章が含まれる。file: の URL を無制限に受け付けると、
 * 呼び出し側のモデルがだまされたときに、鍵や設定ファイルの中身を読み出す経路になる。
 * そのため、許可したディレクトリの中にある HTML ファイルだけを開く。
 */
function resolveAllowedFile(url: URL): URL {
  if (!getSettings().allowFile) {
    throw new Error(tr("このサーバーは、file: の URL を受け付けない設定で起動されています。", "This server was started with file: URLs disabled."));
  }
  // ホスト名つきの file: URL は、Windows ではネットワーク上の共有フォルダを指す。開こうとするだけで
  // 認証情報が外へ送られることがあるので、ファイルに触れる前に断る。
  if (url.hostname !== "" && url.hostname !== "localhost") {
    throw new Error(tr("ホスト名つきの file: URL は開けません。", "file: URLs with a host name cannot be opened."));
  }
  const root = fileRoot();
  const outside = (candidate: string): boolean => {
    const relative = path.relative(root, candidate);
    return relative.startsWith("..") || path.isAbsolute(relative);
  };
  const outsideError = (): Error =>
    new Error(
      tr(
        `file: の URL は ${root} の中だけを開けます。別の場所を検査するには、起動時のオプション --file-root で指定してください。`,
        `file: URLs may only be opened inside ${root}. To audit another location, start the server with --file-root.`,
      ),
    );
  // まず文字列の上で範囲を確かめ、範囲の外のパスにはファイルシステムの問い合わせをしない。
  const lexical = path.resolve(fileURLToPath(url));
  if (lexical.startsWith("\\\\") || lexical.startsWith("//") || outside(lexical)) throw outsideError();
  let real: string;
  try {
    real = realpathSync(lexical);
  } catch {
    throw new Error(tr(`ファイルが見つかりません: ${url.pathname}`, `File not found: ${url.pathname}`));
  }
  // リンクをたどった先も、範囲の中にあることを確かめる。
  if (outside(real)) throw outsideError();
  if (!HTML_EXTENSIONS.has(path.extname(real).toLowerCase())) {
    throw new Error(tr("file: の URL で開けるのは、拡張子が .html、.htm、.xhtml のファイルだけです。", "Only .html, .htm and .xhtml files may be opened through file: URLs."));
  }
  // 確かめたあとでリンク先を差し替えられないよう、解決済みの実体のパスを開く。
  const resolved = pathToFileURL(real);
  resolved.search = url.search;
  resolved.hash = url.hash;
  return resolved;
}

function hostNotAllowed(url: URL): string {
  return tr(`${url.host} は、このサーバーが開いてよいホストに含まれていません (許可: ${getSettings().allowedHosts?.join("、")})。対象を増やすには、起動時のオプション --allow-host で指定してください。`, `${url.host} is not among the hosts this server may open (allowed: ${getSettings().allowedHosts?.join(", ")}). To add it, start the server with --allow-host.`);
}

export function assertAllowedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(tr(`URL として解釈できません: ${raw}`, `Not a valid URL: ${raw}`));
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error(tr(`対応していない URL スキームです: ${url.protocol} (http / https / file のみ)`, `Unsupported URL scheme: ${url.protocol} (only http, https and file)`));
  }
  if (url.protocol === "file:") return resolveAllowedFile(url);
  if (!isHostAllowed(url)) throw new Error(hostNotAllowed(url));
  return url;
}

/** 検査の結果に、利用者へ伝える補足を足す。 */
function addNote(result: unknown, note: string): void {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return;
  const target = result as { notes?: string[] };
  target.notes = [...(target.notes ?? []), note];
}

/**
 * ページを開いて検査関数を実行する。呼び出しごとにブラウザを起動して閉じるので、
 * 検査どうしが Cookie やフォーカス状態を引き継ぐことはない。
 */
export async function withPage<T>(options: PageOptions, run: (page: Page) => Promise<T>): Promise<T> {
  const url = assertAllowedUrl(options.url);
  const timeout = options.timeoutMs ?? 30_000;
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: options.viewport,
      deviceScaleFactor: 1,
      // デスクトップで拡大したときの挙動を再現するため、モバイル扱いにはしない。
      isMobile: false,
      reducedMotion: "reduce",
    });
    const SAFE_SCHEMES = new Set(["about:", "data:", "blob:", "chrome-error:"]);
    /** iframe が読み込んでよい URL か。data: や about:blank は親のページ自身の内容なので止めない。 */
    const frameAllowed = (target: URL): boolean => {
      if (/^https?:$/.test(target.protocol)) return isFrameHostAllowed(target, url);
      if (target.protocol !== "file:") return SAFE_SCHEMES.has(target.protocol);
      const frames = getSettings().allowedFrameHosts;
      if (url.protocol !== "file:" || !(frames.includes("self") || frames.includes("*"))) return false;
      try {
        resolveAllowedFile(target);
        return true;
      } catch {
        return false;
      }
    };
    /**
     * ページそのものが移動してよい URL か。file: は、file: のページから、許可したディレクトリの中の
     * HTML ファイルへ移る場合だけを認める。
     */
    const topAllowed = (target: URL): boolean => {
      if (/^https?:$/.test(target.protocol)) return isHostAllowed(target);
      if (target.protocol === "file:") {
        if (url.protocol !== "file:") return false;
        try {
          resolveAllowedFile(target);
          return true;
        } catch {
          return false;
        }
      }
      return SAFE_SCHEMES.has(target.protocol);
    };
    const blockedFrames = new Set<string>();

    // ページを移動する要求を、移動する前に確かめる。画像などの読み込みは止めない。
    await context.route("**/*", (route) => {
      const request = route.request();
      if (!request.isNavigationRequest()) return route.fallback();
      let target: URL;
      try {
        target = new URL(request.url());
      } catch {
        return route.abort("blockedbyclient");
      }
      if (request.frame().parentFrame() !== null) {
        if (frameAllowed(target)) return route.fallback();
        blockedFrames.add(target.protocol === "file:" ? target.pathname : target.origin);
        return route.abort("blockedbyclient");
      }
      return topAllowed(target) ? route.fallback() : route.abort("blockedbyclient");
    });

    const page = await context.newPage();
    page.setDefaultTimeout(timeout);

    // サーバー側の転送は上の仕組みを通らないので、どのフレームがどこへ着いたかを見張る。
    // 許可していない場所に一度でも着いたら、検査の結果は返さない。
    let violation: string | undefined;
    const watch = (raw: string, isChild: boolean): void => {
      let target: URL;
      try {
        target = new URL(raw);
      } catch {
        return;
      }
      if (isChild) {
        if (!frameAllowed(target)) violation ??= tr(`iframe が、読み込みを許可していない ${target.protocol === "file:" ? target.pathname : target.host} に着きました。iframe の読み込みを許可するには、起動時のオプション --allow-frame-host で指定してください。`, `An iframe reached ${target.protocol === "file:" ? target.pathname : target.host}, which it is not allowed to load. To allow iframe loads, start the server with --allow-frame-host.`);
      } else if (!topAllowed(target)) {
        violation ??= /^https?:$/.test(target.protocol)
          ? hostNotAllowed(target)
          : tr(`ページが、開くことを許可していない場所 (${target.protocol === "file:" ? target.pathname : target.protocol}) へ移動しました。`, `The page moved to a location it is not allowed to open (${target.protocol === "file:" ? target.pathname : target.protocol}).`);
      }
    };
    page.on("framenavigated", (frame) => watch(frame.url(), frame.parentFrame() !== null));
    const assertStayed = (): void => {
      watch(page.url(), false);
      if (violation) throw new Error(violation);
    };
    await page.goto(url.href, { waitUntil: "load", timeout });
    assertStayed();
    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { state: "attached", timeout });
    }
    if (options.waitMs) {
      await page.waitForTimeout(options.waitMs);
    }
    assertStayed();
    await page.evaluate(installHelpers);
    const result = await run(page);
    assertStayed();
    if (blockedFrames.size > 0) {
      addNote(result, tr(`iframe の読み込みを ${blockedFrames.size} 件止めました (${[...blockedFrames].slice(0, 5).join("、")})。iframe の中身は検査にも画像にも含まれていません。含めるには、起動時のオプション --allow-frame-host で指定してください。`, `Blocked ${blockedFrames.size} iframe load(s) (${[...blockedFrames].slice(0, 5).join(", ")}). Iframe content is not included in the checks or the screenshots. To include it, start the server with --allow-frame-host.`));
    }
    return result;
  } finally {
    await browser?.close();
  }
}
