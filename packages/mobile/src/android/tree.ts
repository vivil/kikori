/** UI Automator が書き出す画面の階層 (XML) を読む。 */

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface UiNode {
  className: string;
  packageName: string;
  resourceId: string;
  text: string;
  contentDesc: string;
  hint: string;
  bounds: Bounds;
  clickable: boolean;
  longClickable: boolean;
  checkable: boolean;
  focusable: boolean;
  scrollable: boolean;
  enabled: boolean;
  password: boolean;
  children: UiNode[];
  parent: UiNode | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescape(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function parseBounds(value: string | undefined): Bounds {
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value ?? "");
  if (!match) return { left: 0, top: 0, right: 0, bottom: 0 };
  return { left: Number(match[1]), top: Number(match[2]), right: Number(match[3]), bottom: Number(match[4]) };
}

/**
 * 階層の XML を木に直す。返すのは、いちばん外側の node の一覧。
 * 書式は UI Automator のものに限られるので、汎用の XML パーサーは使わない。
 */
export function parseHierarchy(xml: string): UiNode[] {
  if (!/<hierarchy[\s>]/.test(xml)) throw new Error("not a UI Automator hierarchy");
  const roots: UiNode[] = [];
  const stack: UiNode[] = [];
  const tag = /<(\/?)node((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g;
  for (let match = tag.exec(xml); match; match = tag.exec(xml)) {
    if (match[1] === "/") {
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const [, key, value] of match[2]!.matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[key!] = unescape(value!);
    const flag = (name: string): boolean => attrs[name] === "true";
    const parent = stack[stack.length - 1] ?? null;
    const node: UiNode = {
      className: attrs.class ?? "",
      packageName: attrs.package ?? "",
      resourceId: attrs["resource-id"] ?? "",
      text: (attrs.text ?? "").trim(),
      contentDesc: (attrs["content-desc"] ?? "").trim(),
      hint: (attrs.hint ?? "").trim(),
      bounds: parseBounds(attrs.bounds),
      clickable: flag("clickable"),
      longClickable: flag("long-clickable"),
      checkable: flag("checkable"),
      focusable: flag("focusable"),
      scrollable: flag("scrollable"),
      enabled: attrs.enabled !== "false",
      password: flag("password"),
      children: [],
      parent,
    };
    (parent ? parent.children : roots).push(node);
    if (match[3] !== "/") stack.push(node);
  }
  return roots;
}

/** 木を、XML に書かれた順 (親が先) に並べる。 */
export function flatten(roots: UiNode[]): UiNode[] {
  const out: UiNode[] = [];
  const visit = (node: UiNode): void => {
    out.push(node);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return out;
}
