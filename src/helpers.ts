/**
 * ページ内で使う共通関数。page.evaluate に渡して window.__kikori に登録する。
 * この関数はブラウザ側で文字列化されて実行されるため、外側の変数を参照してはいけない。
 */

export interface ElementInfo {
  selector: string;
  tag: string;
  role: string | null;
  text: string;
}

export interface TextMeasure {
  visible: boolean;
  /** 祖先の overflow: hidden / clip によって文字が切れているか */
  clipped: boolean;
  /** 文字そのものが占める矩形 (ビューポート座標) */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface KikoriHelpers {
  selector(el: Element): string;
  describe(el: Element): ElementInfo;
  isVisible(el: Element): boolean;
  /** 文字を直接持つ要素を集めて記憶し、件数を返す */
  collectText(limit: number): number;
  /** collectText で集めた要素を、同じ並びで測り直す */
  measureText(): TextMeasure[];
  /** collectText で集めた要素のうち、新しく重なった組を返す */
  overlappingPairs(): string[];
  textElement(index: number): Element | undefined;
  textElements: Element[];
}

declare global {
  interface Window {
    __kikori: KikoriHelpers;
  }
}

export function installHelpers(): void {
  const selector = (el: Element): string => {
    const uniqueId = (e: Element): string | null => {
      if (!e.id) return null;
      const sel = `#${CSS.escape(e.id)}`;
      try {
        return document.querySelectorAll(sel).length === 1 ? sel : null;
      } catch {
        return null;
      }
    };
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement) {
      const id = uniqueId(cur);
      if (id) {
        parts.unshift(id);
        return parts.join(" > ");
      }
      let part = cur.tagName.toLowerCase();
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const tagName = cur.tagName;
        const same = Array.from(parent.children).filter((c) => c.tagName === tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.length > 0 ? parts.join(" > ") : "html";
  };

  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    if (style.visibility !== "visible" || style.display === "none") return false;
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    }
    return true;
  };

  const describe = (el: Element): ElementInfo => {
    const label = el.getAttribute("aria-label") ?? (el as HTMLElement).innerText ?? el.textContent ?? "";
    return {
      selector: selector(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      text: label.replace(/\s+/g, " ").trim().slice(0, 80),
    };
  };

  const hasDirectText = (el: Element): boolean => {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "") return true;
    }
    return false;
  };

  /** 要素が直接持つテキストノードだけを囲む矩形 */
  const textRect = (el: Element): DOMRect | null => {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    const range = document.createRange();
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || (node.textContent ?? "").trim() === "") continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width === 0 || r.height === 0) continue;
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
      }
    }
    if (left === Infinity) return null;
    return new DOMRect(left, top, right - left, bottom - top);
  };

  const isClipping = (value: string): boolean => value === "hidden" || value === "clip";
  const isScrolling = (value: string): boolean => value === "auto" || value === "scroll";

  /** 文字の矩形が、祖先の overflow: hidden / clip の外にはみ出しているか */
  const isClipped = (el: Element, rect: DOMRect): boolean => {
    let checkX = true;
    let checkY = true;
    for (let cur: Element | null = el; cur && (checkX || checkY); cur = cur.parentElement) {
      const style = getComputedStyle(cur);
      if (style.display === "inline") continue;
      const box = cur.getBoundingClientRect();
      // 視覚的に隠すための 1px の箱 (sr-only など) は対象外にする。
      if (box.width <= 1 || box.height <= 1) return false;
      if (checkX) {
        if (isClipping(style.overflowX) && (rect.right > box.right + 1 || rect.left < box.left - 1)) return true;
        if (isScrolling(style.overflowX)) checkX = false;
      }
      if (checkY) {
        if (isClipping(style.overflowY) && (rect.bottom > box.bottom + 1 || rect.top < box.top - 1)) return true;
        if (isScrolling(style.overflowY)) checkY = false;
      }
    }
    return false;
  };

  const helpers: KikoriHelpers = {
    selector,
    describe,
    isVisible,
    textElements: [],
    collectText(limit) {
      const found: Element[] = [];
      for (const el of document.body.querySelectorAll("*")) {
        if (found.length >= limit) break;
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) continue;
        if (hasDirectText(el) && isVisible(el)) found.push(el);
      }
      helpers.textElements = found;
      return found.length;
    },
    measureText() {
      return helpers.textElements.map((el) => {
        const rect = el.isConnected && isVisible(el) ? textRect(el) : null;
        if (!rect) return { visible: false, clipped: false, x: 0, y: 0, w: 0, h: 0 };
        return { visible: true, clipped: isClipped(el, rect), x: rect.x, y: rect.y, w: rect.width, h: rect.height };
      });
    },
    overlappingPairs() {
      const els = helpers.textElements;
      const rects = els.map((el) => (el.isConnected && isVisible(el) ? textRect(el) : null));
      const pairs: string[] = [];
      for (let i = 0; i < els.length; i++) {
        const a = rects[i];
        if (!a) continue;
        for (let j = i + 1; j < els.length; j++) {
          const b = rects[j];
          if (!b) continue;
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w <= 2 || h <= 2) continue;
          const ea = els[i]!;
          const eb = els[j]!;
          if (ea.contains(eb) || eb.contains(ea)) continue;
          pairs.push(`${i}:${j}`);
        }
      }
      return pairs;
    },
    textElement(index) {
      return helpers.textElements[index];
    },
  };
  window.__kikori = helpers;
}
