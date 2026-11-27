import type { CDPSession, Page } from "playwright";

export interface ListenerSummary {
  /** イベントの種類 (click、pointerdown など) */
  type: string;
  selector: string;
}

export interface ListenerReport {
  listeners: ListenerSummary[];
  /** フレームワークが 1 か所でまとめてイベントを受けているか */
  delegated: boolean;
  /** まとめて受けている場合に、個々の要素の処理をフレームワークの内部情報から読み取れたか */
  resolved: boolean;
}

const WINDOW_ONLY = new Set(["devicemotion", "deviceorientation"]);

/**
 * ページに登録されたイベントの処理を集める。
 * Chromium のデバッグ用プロトコルで addEventListener の登録を読み、
 * React のように 1 か所でまとめて受ける作りでは、要素に付いたプロパティから読む。
 */
export async function collectListeners(page: Page, types: string[]): Promise<ListenerReport> {
  const wanted = new Set(types);
  const listeners: ListenerSummary[] = [];
  let delegated = false;

  const cdp: CDPSession = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("DOM.getDocument", { depth: 0 });
    for (const [expression, depth, fallback] of [["window", 0, "window"], ["document", -1, "document"]] as const) {
      const { result } = await cdp.send("Runtime.evaluate", { expression });
      if (!result.objectId) continue;
      const found = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId, depth, pierce: true });
      // Playwright は要素を探すときに、window へポインタ関連の処理を登録する。ページ自身のものと
      // 区別できないので、window からは端末の動きに関するイベントだけを読む。
      const usable = found.listeners.filter((l) => wanted.has(l.type) && (expression !== "window" || WINDOW_ONLY.has(l.type)));
      for (const listener of usable.slice(0, 300)) {
        let selector: string = fallback;
        if (listener.backendNodeId) {
          const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: listener.backendNodeId });
          if (object.objectId) {
            const described = await cdp.send("Runtime.callFunctionOn", {
              objectId: object.objectId,
              returnByValue: true,
              functionDeclaration: `function () {
                if (this.nodeType !== 1) return { selector: "document", root: false };
                const root = Object.keys(this).some((k) => k.startsWith("__reactContainer$")) || "_reactRootContainer" in this;
                return { selector: window.__kikori.selector(this), root };
              }`,
            });
            const value = described.result.value as { selector: string; root: boolean };
            if (value.root) {
              // React の根の要素は全種類のイベントを受けるので、ここからは何も分からない。
              delegated = true;
              continue;
            }
            selector = value.selector;
          }
        }
        listeners.push({ type: listener.type, selector });
      }
    }
  } finally {
    await cdp.detach().catch(() => undefined);
  }

  const react = await page.evaluate((typeList) => {
    const wantedTypes = new Set(typeList);
    const found: { type: string; selector: string }[] = [];
    let sawProps = false;
    for (const el of document.querySelectorAll("*")) {
      const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
      if (!key) continue;
      sawProps = true;
      const props = (el as unknown as Record<string, Record<string, unknown> | undefined>)[key] ?? {};
      for (const [name, handler] of Object.entries(props)) {
        const match = /^on([A-Z][A-Za-z]*?)(Capture)?$/.exec(name);
        if (!match || typeof handler !== "function") continue;
        const type = match[1]!.toLowerCase();
        if (wantedTypes.has(type)) found.push({ type, selector: window.__kikori.selector(el) });
      }
    }
    return { found, sawProps };
  }, types);

  return { listeners: [...listeners, ...react.found], delegated, resolved: react.sawProps };
}
