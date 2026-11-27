/**
 * サーバーの起動時に決める設定。検査対象の範囲は人が決めるもので、
 * ツールの引数からは変えられないようにしている。
 */
export interface Settings {
  /** 検査結果やエラーの文面に使う言語 */
  lang: "ja" | "en";
  /**
   * 開いてよいホストの一覧。null のときは制限しない。
   * 何も指定しなければ、自分のコンピューターで動くサーバー (LOOPBACK_HOSTS) だけになる。
   */
  allowedHosts: string[] | null;
  /**
   * ページの中の iframe が読み込んでよいホスト。空のときは、iframe の読み込みをすべて止める。
   * self は検査しているページと同じホスト、* はすべてのホストを表す。
   */
  allowedFrameHosts: string[];
  /** file: の URL で開いてよいディレクトリ。null のときは、サーバーを起動したディレクトリ。 */
  fileRoot: string | null;
  /** file: の URL を受け付けるか */
  allowFile: boolean;
}

/** 既定で開いてよいホスト。開発サーバーの検査は、設定なしでできるようにする。 */
export const LOOPBACK_HOSTS = ["localhost", "*.localhost", "127.0.0.1", "[::1]"];

/** ホストの一覧を解釈する。* が含まれていれば、すべてのホストを許可する。 */
function hostList(hosts: string[]): string[] | null {
  if (hosts.length === 0) return [...LOOPBACK_HOSTS];
  return hosts.includes("*") ? null : hosts;
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== "");
}

/** 指定がなければ、利用者の環境の言語設定に合わせる。日本語でなければ英語にする。 */
function detectLang(env: NodeJS.ProcessEnv): "ja" | "en" {
  const explicit = env.KIKORI_LANG?.toLowerCase();
  if (explicit === "ja" || explicit === "en") return explicit;
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  return locale.toLowerCase().startsWith("ja") ? "ja" : "en";
}

function fromEnvironment(env: NodeJS.ProcessEnv): Settings {
  const hosts = splitList(env.KIKORI_ALLOWED_HOSTS);
  return {
    lang: detectLang(env),
    allowedHosts: hostList(hosts),
    allowedFrameHosts: splitList(env.KIKORI_ALLOWED_FRAME_HOSTS),
    fileRoot: env.KIKORI_FILE_ROOT ?? null,
    allowFile: env.KIKORI_NO_FILE !== "1",
  };
}

let current: Settings = fromEnvironment(process.env);

export function getSettings(): Settings {
  return current;
}

export function configure(settings: Settings): void {
  current = settings;
}

const USAGE_JA = `使い方: kikori [オプション]
        kikori install [--with-deps]   検査に使うブラウザを入れる。最初に 1 回だけ実行する。
                                       --with-deps は、Linux で必要なライブラリも入れる。

  --lang <ja|en>          検査結果やエラーの文面に使う言語。
                          指定しないときは、環境の言語設定が日本語なら ja、それ以外は en。
  --allow-host <ホスト>   開いてよいホスト。複数回の指定と、カンマ区切りができる。
                          指定しないときは、localhost と 127.0.0.1 だけを開く。
                          * を指定すると、すべてのホストを開く。
                          例: localhost:3000  example.com  *.example.com
  --allow-frame-host <ホスト>
                          ページの中の iframe が読み込んでよいホスト。書き方は --allow-host と同じ。
                          self は検査しているページと同じホスト、* はすべてのホストを表す。
                          指定しないときは、iframe の読み込みをすべて止める。
  --file-root <パス>      file: の URL で開いてよいディレクトリ。
                          既定では、サーバーを起動したディレクトリ。
  --no-file               file: の URL を受け付けない。
  --help                  この説明を表示する。

環境変数 KIKORI_LANG、KIKORI_ALLOWED_HOSTS、KIKORI_ALLOWED_FRAME_HOSTS、KIKORI_FILE_ROOT、
KIKORI_NO_FILE=1 でも指定できる。オプションと環境変数の両方があるときは、オプションを使う。`;

const USAGE_EN = `Usage: kikori [options]
       kikori install [--with-deps]   Install the browser used for the checks. Run it once, first.
                                      --with-deps also installs the libraries needed on Linux.

  --lang <ja|en>          Language for results and errors.
                          Defaults to ja when the system locale is Japanese, otherwise en.
  --allow-host <host>     Host that may be opened. Repeatable, or comma-separated.
                          When omitted, only localhost and 127.0.0.1 may be opened.
                          "*" allows every host.
                          Examples: localhost:3000  example.com  *.example.com
  --allow-frame-host <host>
                          Host that iframes in the page may load. Same syntax as --allow-host.
                          "self" means the host of the audited page, "*" means any host.
                          When omitted, every iframe load is blocked.
  --file-root <path>      Directory that file: URLs may be opened from.
                          Defaults to the directory the server was started in.
  --no-file               Refuse file: URLs.
  --help                  Show this help.

The same settings can be given with the environment variables KIKORI_LANG, KIKORI_ALLOWED_HOSTS,
KIKORI_ALLOWED_FRAME_HOSTS, KIKORI_FILE_ROOT and KIKORI_NO_FILE=1. Options take precedence.`;

export function usage(language: "ja" | "en"): string {
  return language === "ja" ? USAGE_JA : USAGE_EN;
}

function say(language: "ja" | "en", ja: string, en: string): string {
  return language === "ja" ? ja : en;
}

/** 起動時の引数を読む。環境変数の設定を、引数で上書きする。 */
export function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): { settings: Settings; help: boolean } {
  const settings = fromEnvironment(env);
  const hosts: string[] = [];
  const frameHosts: string[] = [];
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [name, inline] = arg.includes("=") ? (arg.split(/=(.*)/s, 2) as [string, string]) : [arg, undefined];
    const value = (): string => {
      const next = inline ?? argv[++i];
      if (next === undefined || next === "") throw new Error(say(settings.lang, `${name} には値が必要です。`, `${name} requires a value.`));
      return next;
    };
    switch (name) {
      case "--lang": {
        const chosen = value().toLowerCase();
        if (chosen !== "ja" && chosen !== "en") throw new Error(say(settings.lang, `--lang には ja か en を指定してください。`, `--lang must be ja or en.`));
        settings.lang = chosen;
        break;
      }
      case "--allow-host":
        hosts.push(...splitList(value()));
        break;
      case "--allow-frame-host":
        frameHosts.push(...splitList(value()));
        break;
      case "--file-root":
        settings.fileRoot = value();
        break;
      case "--no-file":
        settings.allowFile = false;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
      default:
        throw new Error(say(settings.lang, `知らないオプションです: ${arg}`, `Unknown option: ${arg}`));
    }
  }
  if (hosts.length > 0) settings.allowedHosts = hostList(hosts);
  if (frameHosts.length > 0) settings.allowedFrameHosts = frameHosts;
  const HOST = /^(\*\.)?[a-z0-9.-]+(:\d+)?$|^\[[0-9a-f:]+\](:\d+)?$/;
  for (const pattern of settings.allowedHosts ?? []) {
    if (!HOST.test(pattern) && !LOOPBACK_HOSTS.includes(pattern)) {
      throw new Error(
        say(
          settings.lang,
          `ホストの指定として解釈できません: ${pattern} (例: localhost:3000、example.com、*.example.com)`,
          `Not a valid host: ${pattern} (examples: localhost:3000, example.com, *.example.com)`,
        ),
      );
    }
  }
  for (const pattern of settings.allowedFrameHosts) {
    if (pattern !== "*" && !HOST.test(pattern)) {
      throw new Error(
        say(
          settings.lang,
          `ホストの指定として解釈できません: ${pattern} (例: self、*、player.example.com、*.example.com)`,
          `Not a valid host: ${pattern} (examples: self, *, player.example.com, *.example.com)`,
        ),
      );
    }
  }
  return { settings, help };
}

/**
 * http / https の URL が、開いてよいホストに含まれるか。
 * ポートを書いた指定はそのポートだけに、書かない指定はすべてのポートに一致する。
 */
export function isHostAllowed(url: URL, settings: Settings = current): boolean {
  if (!settings.allowedHosts) return true;
  return matchesAny(url, settings.allowedHosts);
}

/**
 * iframe が http / https の URL を読み込んでよいか。top は検査しているページの URL。
 * 一覧が空のときは、どの iframe も読み込ませない。
 */
export function isFrameHostAllowed(url: URL, top: URL, settings: Settings = current): boolean {
  return settings.allowedFrameHosts.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern === "self") return url.protocol === top.protocol && url.host === top.host;
    return matchesAny(url, [pattern]);
  });
}

function matchesAny(url: URL, patterns: string[]): boolean {
  const hostname = url.hostname.toLowerCase();
  const port = url.port || (url.protocol === "https:" || url.protocol === "wss:" ? "443" : "80");
  return patterns.some((pattern) => {
    // IPv6 のアドレスは [::1] のように角括弧で囲んで書く。URL の hostname も同じ形になる。
    const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(pattern);
    if (!match) return false;
    const [, patternHost = "", patternPort] = match;
    if (patternPort && patternPort !== port) return false;
    if (patternHost.startsWith("*.")) return hostname.endsWith(patternHost.slice(1));
    return hostname === patternHost;
  });
}
