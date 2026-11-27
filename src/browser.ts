import { tr } from "./i18n.js";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContextOptions, type Page, type WebSocketRoute } from "playwright";
import { filterStorageState, getSettings, isFrameHostAllowed, isHostAllowed, type StorageState } from "./config.js";
import { installHelpers } from "./helpers.js";
import { launchWithInstall, MissingBrowserError } from "./install.js";

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

/** file: の URL が、許可したディレクトリの中の実在するファイルを指しているか。拡張子は問わない。 */
function isInsideFileRoot(url: URL): boolean {
  if (!getSettings().allowFile || (url.hostname !== "" && url.hostname !== "localhost")) return false;
  try {
    const root = fileRoot();
    const outside = (candidate: string): boolean => {
      const relative = path.relative(root, candidate);
      return relative.startsWith("..") || path.isAbsolute(relative);
    };
    const lexical = path.resolve(fileURLToPath(url));
    return !outside(lexical) && !outside(realpathSync(lexical));
  } catch {
    return false;
  }
}

function hostNotAllowed(url: URL): string {
  const allowed = getSettings().allowedHosts ?? [];
  return tr(
    `${url.host} は、このサーバーが開いてよいホストに含まれていません (許可: ${allowed.join("、")})。対象を増やすには、起動時のオプション --allow-host で指定してください。`,
    `${url.host} is not among the hosts this server may open (allowed: ${allowed.join(", ")}). To add it, start the server with --allow-host.`,
  );
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

const frozen = new WeakSet<Page>();
const socketsOf = new WeakMap<Page, WebSocketRoute[]>();

/**
 * このページからの通信を凍結する。以後、すべての要求が止まり、開いている WebSocket も閉じる。
 * ログイン済みの状態で操作を試すとき、本人の権限で何かが実行されるのを防ぐために使う。元には戻せない。
 */
export function freezeNetwork(page: Page): void {
  frozen.add(page);
  for (const socket of socketsOf.get(page) ?? []) void socket.close({ code: 1001, reason: "frozen" }).catch(() => undefined);
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
    try {
      // ブラウザ本体がまだなければ、設定に応じて、ここで 1 度だけ取得する。
      browser = await launchWithInstall(() => chromium.launch(), getSettings().autoInstall);
    } catch (error) {
      if (!(error instanceof MissingBrowserError)) throw error;
      throw new Error(
        error.downloadFailure
          ? tr(
              `検査に使うブラウザを自動で取得できませんでした (${error.downloadFailure})。ネットワークを確かめ、\`npx kikori install\` を実行してから、もう一度試してください。`,
              `The browser used for the checks could not be downloaded automatically (${error.downloadFailure}). Check the network, run \`npx kikori install\`, then try again.`,
            )
          : tr(
              "検査に使うブラウザが入っていません。`npx kikori install` を実行してから、もう一度試してください。",
              "The browser used for the checks is not installed. Run `npx kikori install`, then try again.",
            ),
      );
    }
    const statePath = getSettings().storageState;
    const storageState = statePath
      ? (filterStorageState(JSON.parse(readFileSync(statePath, "utf8")) as StorageState) as NonNullable<BrowserContextOptions["storageState"]>)
      : undefined;
    const context = await browser.newContext({
      viewport: options.viewport,
      deviceScaleFactor: 1,
      // デスクトップで拡大したときの挙動を再現するため、モバイル扱いにはしない。
      isMobile: false,
      reducedMotion: "reduce",
      // Service Worker が出す要求は、下の確認を通らない。宛先の制限をすり抜けないよう、登録させない。
      serviceWorkers: "block",
      // ログイン済みの状態を読み込む。開いてよいホストに属さない Cookie は、持ち込まない。
      ...(storageState ? { storageState } : {}),
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

    /**
     * 画像、スクリプト、通信などの読み込み先として使ってよい URL か。ページそのものと同じ一覧に従う。
     * file: は、許可したディレクトリの中であれば、HTML 以外のファイルも読み込める。
     */
    const resourceAllowed = (target: URL): boolean => {
      if (/^(https?|wss?):$/.test(target.protocol)) return isHostAllowed(target);
      if (target.protocol === "file:") return url.protocol === "file:" && isInsideFileRoot(target);
      return SAFE_SCHEMES.has(target.protocol);
    };
    const blockedResources = new Set<string>();
    const sockets: WebSocketRoute[] = [];
    let page!: Page;

    // すべての要求を、送る前に確かめる。
    await context.route("**/*", (route) => {
      const request = route.request();
      let target: URL;
      try {
        target = new URL(request.url());
      } catch {
        return route.abort("blockedbyclient");
      }
      // 通信を凍結している間は、ここに届いた要求をすべて止める。iframe の読み込みも、
      // 新しく開いたウィンドウからの要求も含む。
      if (frozen.has(page)) return route.abort("blockedbyclient");
      if (!request.isNavigationRequest()) {
        if (resourceAllowed(target)) return route.fallback();
        blockedResources.add(target.protocol === "file:" ? target.pathname : target.host);
        return route.abort("blockedbyclient");
      }
      if (request.frame().parentFrame() !== null) {
        if (frameAllowed(target)) return route.fallback();
        blockedFrames.add(target.protocol === "file:" ? target.pathname : target.origin);
        return route.abort("blockedbyclient");
      }
      return topAllowed(target) ? route.fallback() : route.abort("blockedbyclient");
    });
    // WebSocket は上の仕組みを通らないので、別に確かめる。
    await context.routeWebSocket(/.*/, (ws) => {
      let allowed = false;
      try {
        allowed = resourceAllowed(new URL(ws.url()));
      } catch {
        allowed = false;
      }
      if (allowed && !frozen.has(page)) {
        ws.connectToServer();
        sockets.push(ws);
      } else if (allowed) {
        void ws.close({ code: 1008, reason: "blocked" });
      } else {
        blockedResources.add(new URL(ws.url()).host);
        void ws.close({ code: 1008, reason: "blocked" });
      }
    });

    page = await context.newPage();
    page.setDefaultTimeout(timeout);
    socketsOf.set(page, sockets);

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
    // 読み込みの転送も、送る前の確認を通らない。許可したホストが一覧にないホストへ転送したら、
    // その中身が画面に写っているおそれがあるので、結果を返さない。
    page.on("request", (request) => {
      if (request.redirectedFrom() === null || request.isNavigationRequest()) return;
      let target: URL;
      try {
        target = new URL(request.url());
      } catch {
        return;
      }
      if (!resourceAllowed(target)) {
        violation ??= tr(
          `読み込みが、開いてよいホストに含まれない ${target.host} へ転送されました。読み込ませるには、起動時のオプション --allow-host で指定してください。`,
          `A load was redirected to ${target.host}, which is not among the allowed hosts. To let it load, start the server with --allow-host.`,
        );
      }
    });
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
    if (blockedResources.size > 0) {
      const hosts = [...blockedResources].slice(0, 8).join(tr("、", ", "));
      addNote(
        result,
        tr(
          `開いてよいホストに含まれない ${blockedResources.size} 件の宛先 (${hosts}) からの読み込みを止めました。フォントやスタイルが読み込まれず、見た目が実際と違っている可能性があります。読み込ませるには、起動時のオプション --allow-host で指定してください。`,
          `Blocked loads from ${blockedResources.size} destination(s) outside the allowed hosts (${hosts}). Fonts or styles may be missing, so the page may look different from what users see. To let them load, start the server with --allow-host.`,
        ),
      );
    }
    if (blockedFrames.size > 0) {
      addNote(result, tr(`iframe の読み込みを ${blockedFrames.size} 件止めました (${[...blockedFrames].slice(0, 5).join("、")})。iframe の中身は検査にも画像にも含まれていません。含めるには、起動時のオプション --allow-frame-host で指定してください。`, `Blocked ${blockedFrames.size} iframe load(s) (${[...blockedFrames].slice(0, 5).join(", ")}). Iframe content is not included in the checks or the screenshots. To include it, start the server with --allow-frame-host.`));
    }
    return result;
  } finally {
    await browser?.close();
  }
}
