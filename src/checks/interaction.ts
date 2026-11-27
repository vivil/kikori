import { tr } from "../i18n.js";
import type { Page } from "playwright";
import { freezeNetwork, withPage } from "../browser.js";
import { getSettings } from "../config.js";
import { SC, summarize, type CheckResult, type Finding } from "../types.js";
import type { ElementInfo } from "../helpers.js";
import { collectListeners } from "../listeners.js";

export interface InteractionOptions {
  url: string;
  width?: number;
  height?: number;
  waitForSelector?: string;
  waitMs?: number;
}

const POINTER_EVENTS = ["dragstart", "touchmove", "gesturestart", "gesturechange", "gestureend", "mousedown", "pointerdown", "touchstart", "devicemotion", "deviceorientation"];

interface StaticReport {
  lowContrastControls: (ElementInfo & { ratio: number; boundary: string; background: string })[];
  fastAnimations: (ElementInfo & { periodMs: number })[];
  hasFlashingMedia: boolean;
  liveRegions: number;
  statusCandidates: ElementInfo[];
  hasScriptsOrForms: boolean;
  formControls: number;
  /** draggable 属性が付いた要素のセレクタ */
  draggable: string[];
  /** パスワードの入力欄と、その入力を妨げる指定 */
  passwordFields: (ElementInfo & { autocompleteOff: boolean; pasteBlocked: boolean })[];
  /** 画像の文字を読ませるなど、認知機能のテストを課していそうな要素 */
  captchas: ElementInfo[];
}

const MAX_REPORTED = 15;
const PROBE_KEYS = [..."abcdefghijklmnopqrstuvwxyz0123456789", "?", "/"];
const MAX_HOVER_TARGETS = 40;
const MAX_INPUT_TARGETS = 10;

/**
 * 実際に操作して確かめる検査。ホバー、文字キー、入力欄の変更を試す。
 * ページを移動する要求と、GET 以外の要求は止めるので、サーバー側のデータは変えない。
 */
export async function checkInteraction(options: InteractionOptions): Promise<CheckResult> {
  const viewport = { width: options.width ?? 1280, height: options.height ?? 720 };

  return withPage({ ...options, viewport }, async (page) => {
    const findings: Finding[] = [];
    const notes: string[] = [];
    const checked: string[] = [];
    const inapplicable: string[] = [];
    const needsJudgment: string[] = [];

    const navigations: { url: string; method: string }[] = [];
    let popups = 0;
    page.on("popup", (popup) => {
      popups++;
      void popup.close().catch(() => undefined);
    });
    await page.route("**/*", (route) => {
      const request = route.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        navigations.push({ url: request.url(), method: request.method() });
        return route.abort();
      }
      if (request.method() !== "GET" && request.method() !== "HEAD") return route.abort();
      // 起動時に決めた宛先の制限へ処理を引き継ぐ。
      return route.fallback();
    });

    // --- 静的に分かること: コントラスト、速い点滅、ステータスメッセージ ---
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(100);
    const report = await page.evaluate(collectStatic);
    await page.emulateMedia({ reducedMotion: "reduce" });

    for (const control of report.lowContrastControls.slice(0, MAX_REPORTED)) {
      findings.push({
        sc: SC.nonTextContrast,
        severity: "review",
        selector: control.selector,
        message: tr(`入力欄の境界 (${control.boundary}) と周りの背景 (${control.background}) のコントラスト比が ${control.ratio.toFixed(2)}:1 で、3:1 に届きません。枠線や背景の色を濃くしてください。`, `The contrast between the field boundary (${control.boundary}) and the surrounding background (${control.background}) is ${control.ratio.toFixed(2)}:1, below 3:1. Darken the border or the background.`),
        details: { ratio: Number(control.ratio.toFixed(2)), boundary: control.boundary, background: control.background },
      });
    }
    checked.push("1.4.11");
    // アイコンや図のコントラストは、画面を見て判断する必要がある。
    needsJudgment.push("1.4.11");

    for (const animation of report.fastAnimations.slice(0, MAX_REPORTED)) {
      findings.push({
        sc: SC.threeFlashes,
        severity: "review",
        selector: animation.selector,
        message: tr(`色や透明度が ${Math.round(animation.periodMs)} ミリ秒の周期で繰り返し変わります。1 秒に 3 回を超える閃光にあたらないか、面積と明るさの差を確認してください。`, `Color or opacity changes repeatedly every ${Math.round(animation.periodMs)} ms. Check its area and brightness difference to make sure it is not a flash occurring more than three times a second.`),
        details: { periodMs: Math.round(animation.periodMs) },
      });
    }
    if (report.hasFlashingMedia) needsJudgment.push("2.3.1");
    else checked.push("2.3.1");

    if (!report.hasScriptsOrForms) {
      inapplicable.push("4.1.3");
    } else {
      for (const candidate of report.statusCandidates.slice(0, MAX_REPORTED)) {
        findings.push({
          sc: SC.statusMessages,
          severity: "review",
          selector: candidate.selector,
          message: tr('ステータスメッセージを表示する領域に見えますが、role="status" や aria-live の指定がありません。フォーカスを移さずに表示する通知であれば、指定を追加してください。', 'Looks like a region for status messages but has no role="status" or aria-live. If it shows notifications without moving focus, add one.'),
          details: { text: candidate.text },
        });
      }
      needsJudgment.push("4.1.3");
    }

    // --- イベントリスナーから分かること: ジェスチャ、押した時点での実行、動きによる起動 ---
    const listenerReport = await collectListeners(page, POINTER_EVENTS).catch(() => null);
    if (!listenerReport) {
      notes.push(tr("イベントリスナーを取得できなかったため、2.5.1、2.5.2、2.5.4 は検査していません。", "Event listeners could not be read, so 2.5.1, 2.5.2 and 2.5.4 were not checked."));
    } else {
      const direct = listenerReport.listeners;
      const group = (types: string[]): Map<string, string[]> => {
        const bySelector = new Map<string, string[]>();
        for (const l of direct) {
          if (types.includes(l.type)) bySelector.set(l.selector, [...new Set([...(bySelector.get(l.selector) ?? []), l.type])]);
        }
        return bySelector;
      };
      const report251 = group(["touchmove", "gesturestart", "gesturechange", "gestureend"]);
      for (const [selector, types] of [...report251].slice(0, MAX_REPORTED)) {
        findings.push({
          sc: SC.pointerGestures,
          severity: "review",
          selector,
          message: tr(`${types.join("、")} のイベントを受け取っています。スワイプやピンチのような操作を使う場合は、1 回のタップやボタンでも同じことができるか確認してください。`, `Listens for ${types.join(", ")}. If gestures such as swipe or pinch are used, check that a single tap or a button can do the same.`),
          details: { events: types },
        });
      }
      const report252 = group(["mousedown", "pointerdown", "touchstart"]);
      for (const [selector, types] of [...report252].slice(0, MAX_REPORTED)) {
        findings.push({
          sc: SC.pointerCancellation,
          severity: "review",
          selector,
          message: tr(`${types.join("、")} のイベントを受け取っています。押した時点で機能を実行している場合は、離した時点で実行するように変えるか、取り消せるようにしてください。`, `Listens for ${types.join(", ")}. If the function runs on the down event, run it on the up event instead or make it possible to cancel.`),
          details: { events: types },
        });
      }
      const draggable = new Map([...group(["dragstart"])]);
      for (const selector of report.draggable) if (!draggable.has(selector)) draggable.set(selector, ["draggable"]);
      for (const [selector, types] of [...draggable].slice(0, MAX_REPORTED)) {
        findings.push({
          sc: SC.dragging,
          severity: "review",
          selector,
          message: tr(
            `ドラッグで操作する要素です (${types.join("、")})。ドラッグせずに、1 回のクリックやボタンでも同じ操作ができるか確認してください。`,
            `This element is operated by dragging (${types.join(", ")}). Check that the same thing can be done without dragging, with a single click or a button.`,
          ),
          details: { events: types },
        });
      }
      checked.push("2.5.7");
      const report254 = group(["devicemotion", "deviceorientation"]);
      for (const [selector, types] of report254) {
        findings.push({
          sc: SC.motionActuation,
          severity: "review",
          selector,
          message: tr(`${types.join("、")} のイベントを受け取っています。端末を動かして操作する機能がある場合は、画面上の部品でも操作でき、動きによる起動を無効にできるか確認してください。`, `Listens for ${types.join(", ")}. If a function is operated by moving the device, check that on-screen controls can do the same and that motion actuation can be turned off.`),
          details: { events: types },
        });
      }
      checked.push("2.5.4");
      if (listenerReport.delegated && !listenerReport.resolved) {
        // 全種類のイベントを 1 か所で受ける作りで、個々の要素の処理も読み取れなかった。
        needsJudgment.push("2.5.1", "2.5.2");
        notes.push(tr("フレームワークがイベントをまとめて受け取っているため、2.5.1 と 2.5.2 はリスナーの有無から判断できません。ソースコードで touchmove や pointerdown の扱いを確認してください。", "A framework receives events in one place, so 2.5.1 and 2.5.2 cannot be decided from the listeners. Check how touchmove and pointerdown are handled in the source code."));
      } else {
        checked.push("2.5.1", "2.5.2");
      }
    }

    // --- 3.3.8 / 3.3.9: 認証で、覚える・書き写す・解くことを強いていないか ---
    if (report.passwordFields.length === 0 && report.captchas.length === 0) {
      inapplicable.push("3.3.8", "3.3.9");
    } else {
      for (const field of report.passwordFields) {
        if (field.pasteBlocked) {
          findings.push({
            sc: SC.accessibleAuthentication,
            severity: "fail",
            selector: field.selector,
            message: tr(
              "パスワードの欄が貼り付けを拒否しています。パスワード管理ツールや貼り付けで入力できないと、覚えるか書き写すしかなくなります。貼り付けを許可してください。",
              "The password field rejects paste. Without paste or a password manager, users have to memorise or transcribe the password. Allow pasting.",
            ),
            details: { text: field.text },
          });
        } else if (field.autocompleteOff) {
          findings.push({
            sc: SC.accessibleAuthentication,
            severity: "review",
            selector: field.selector,
            message: tr(
              'パスワードの欄に autocomplete="off" が指定されています。パスワード管理ツールで入力できるか確認し、current-password か new-password を指定してください。',
              'The password field has autocomplete="off". Check that a password manager can fill it, and set current-password or new-password.',
            ),
            details: { text: field.text },
          });
        }
      }
      for (const captcha of report.captchas.slice(0, MAX_REPORTED)) {
        // 物体の認識による認証は、最低限の基準 (AA) では例外として認められるが、高度な基準 (AAA) では認められない。
        for (const sc of [SC.accessibleAuthentication, SC.accessibleAuthenticationEnhanced]) {
          findings.push({
            sc,
            severity: "review",
            selector: captcha.selector,
            message: tr(
              "CAPTCHA のような、認知機能のテストに見える要素があります。文字の読み取りやパズルを課す場合は、それに頼らない認証の手段があるか確認してください。",
              "This looks like a cognitive function test, such as a CAPTCHA. If it asks users to read characters or solve a puzzle, check that there is a way to authenticate that does not depend on it.",
            ),
            details: { text: captcha.text },
          });
        }
      }
      checked.push("3.3.8", "3.3.9");
    }

    // --- 2.1.4: 文字キーだけで動くショートカットがないか ---
    // ログイン済みの状態で操作を試す間は、通信をすべて止める。画像の読み込みや送信用の API を使っても、
    // 本人の権限で設定の切り替えなどを実行できないようにする。
    if (getSettings().storageState !== null) {
      freezeNetwork(page);
      notes.push(
        tr(
          "ログイン済みの状態を読み込んでいるため、操作を試す間は通信をすべて止めました。ホバーで現れる内容のうち、通信して取得するものは検出できていません。",
          "A login state is loaded, so all requests were blocked while trying interactions. Hover content that is fetched over the network was not detected.",
        ),
      );
    }
    const reacted = await probeCharacterKeys(page, navigations);
    if (reacted.length > 0) {
      findings.push({
        sc: SC.characterKeyShortcuts,
        severity: "review",
        selector: "html",
        message: tr(`文字キー (${reacted.slice(0, 12).join(" ")}) を押しただけで画面が変化しました。1 文字のショートカットがある場合は、無効にするか、修飾キーつきに変える手段が必要です。`, `Pressing a character key alone (${reacted.slice(0, 12).join(" ")}) changed the page. If there are single-character shortcuts, a way to turn them off or remap them to include a modifier key is required.`),
        details: { keys: reacted },
      });
    }
    checked.push("2.1.4");

    // --- 1.4.13: ホバーで現れる内容が、消せて、ポインタを載せられるか ---
    const hover = await probeHover(page);
    findings.push(...hover.findings);
    checked.push("1.4.13");
    if (hover.truncated) notes.push(tr(`ホバーを試したのは先頭の ${MAX_HOVER_TARGETS} 個の要素だけです。`, `Hover was tried on the first ${MAX_HOVER_TARGETS} elements only.`));

    // --- 3.2.2: 入力欄の値を変えただけで、画面が移動しないか ---
    if (report.formControls === 0) {
      inapplicable.push("3.2.2");
    } else {
      findings.push(...(await probeInputs(page, navigations, () => popups)));
      checked.push("3.2.2");
    }

    return {
      check: "interaction",
      url: options.url,
      viewport,
      summary: summarize(findings),
      findings,
      checked,
      inapplicable,
      needsJudgment,
      data: { hoverContentFound: hover.found, formControls: report.formControls, liveRegions: report.liveRegions },
      ...(notes.length > 0 ? { notes } : {}),
    };
  });
}

async function probeCharacterKeys(page: Page, navigations: unknown[]): Promise<string[]> {
  // タイマーなどで勝手に書き換わるページでは、DOM の変化をキーの影響と区別できない。
  const idle = await page.evaluate(async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    let count = 0;
    const observer = new MutationObserver((records) => (count += records.length));
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    observer.disconnect();
    return count;
  });
  await page.evaluate((watchDom) => {
    const state = { mutations: 0 };
    if (watchDom) {
      new MutationObserver((records) => (state.mutations += records.length)).observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    }
    (window as unknown as { __kikoriKeys: typeof state }).__kikoriKeys = state;
  }, idle === 0);

  const snapshot = (): Promise<string> =>
    page.evaluate(() => {
      const state = (window as unknown as { __kikoriKeys: { mutations: number } }).__kikoriKeys;
      const active = document.activeElement;
      return [state.mutations, location.href, window.scrollX, window.scrollY, active ? window.__kikori.selector(active) : ""].join("|");
    });

  const reacted: string[] = [];
  let before = `${await snapshot()}|${navigations.length}`;
  for (const key of PROBE_KEYS) {
    await page.keyboard.press(key);
    await page.waitForTimeout(25);
    const after = `${await snapshot()}|${navigations.length}`;
    if (after !== before) {
      reacted.push(key);
      // 開いたダイアログなどを閉じ、次のキーを同じ条件で試す。
      await page.keyboard.press("Escape");
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.waitForTimeout(25);
      before = `${await snapshot()}|${navigations.length}`;
    }
  }
  return reacted;
}

async function probeHover(page: Page): Promise<{ findings: Finding[]; found: number; truncated: boolean }> {
  const findings: Finding[] = [];
  const total = await page.evaluate((max) => {
    const kikori = window.__kikori;
    const PRIORITY = "[aria-describedby], [aria-haspopup], [data-tooltip], [data-tip], [data-bs-toggle], [data-tippy-content]";
    const OTHERS = "a[href], button, [role='button'], [role='menuitem'], summary, [tabindex]:not([tabindex='-1'])";
    const targets = [...new Set([...document.querySelectorAll(PRIORITY), ...document.querySelectorAll(OTHERS)])].filter((el) => kikori.isVisible(el));
    const picked = targets.slice(0, max);
    const store = {
      targets: picked,
      baseline: new Set<Element>(),
      visibleNow(): Set<Element> {
        const set = new Set<Element>();
        for (const el of document.body.querySelectorAll("*")) if (kikori.isVisible(el)) set.add(el);
        return set;
      },
      /** 基準の時点から新しく見えるようになった要素のうち、いちばん外側のもの */
      appeared(): Element | null {
        for (const el of store.visibleNow()) {
          if (store.baseline.has(el)) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width >= 4 && rect.height >= 4) return el;
        }
        return null;
      },
    };
    (window as unknown as { __kikoriHover: typeof store }).__kikoriHover = store;
    return { picked: picked.length, all: targets.length };
  }, MAX_HOVER_TARGETS);

  type Probe = { trigger: ElementInfo; triggerBox: { x: number; y: number }; content: ElementInfo; contentBox: { x: number; y: number } } | null;
  const appeared = (index: number): Promise<Probe> =>
    page.evaluate((i) => {
      const store = (window as unknown as { __kikoriHover: { targets: Element[]; appeared(): Element | null } }).__kikoriHover;
      const el = store.appeared();
      const trigger = store.targets[i];
      if (!el || !trigger) return null;
      const center = (e: Element): { x: number; y: number } => {
        const r = e.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      return { trigger: window.__kikori.describe(trigger), triggerBox: center(trigger), content: window.__kikori.describe(el), contentBox: center(el) };
    }, index);
  const stillVisible = (selector: string): Promise<boolean> =>
    page.evaluate((sel) => {
      try {
        const el = document.querySelector(sel);
        return el !== null && window.__kikori.isVisible(el);
      } catch {
        return false;
      }
    }, selector);

  let found = 0;
  for (let i = 0; i < total.picked; i++) {
    await page.mouse.move(0, 0);
    await page.waitForTimeout(60);
    const box = await page.evaluate((index) => {
      const store = (window as unknown as { __kikoriHover: { targets: Element[]; baseline: Set<Element>; visibleNow(): Set<Element> } }).__kikoriHover;
      store.baseline = store.visibleNow();
      const el = store.targets[index];
      if (!el || !el.isConnected) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, i);
    if (!box) continue;
    await page.mouse.move(box.x, box.y);
    await page.waitForTimeout(250);
    const probe = await appeared(i);
    if (!probe) continue;
    found++;
    if (found > 8) continue;

    // ポインタを現れた内容の上へ動かしても、消えずに残るか。
    await page.mouse.move(probe.contentBox.x, probe.contentBox.y, { steps: 8 });
    await page.waitForTimeout(250);
    if (!(await stillVisible(probe.content.selector))) {
      findings.push({
        sc: SC.hoverContent,
        severity: "fail",
        selector: probe.trigger.selector,
        message: tr(`ホバーで現れる内容 (${probe.content.selector}) が、ポインタを載せようとすると消えます。内容の上にポインタを移しても表示が続くようにしてください。`, `Content shown on hover (${probe.content.selector}) disappears when the pointer moves onto it. Keep it visible while the pointer is over the content.`),
        details: { content: probe.content.selector, text: probe.content.text },
      });
      continue;
    }
    // Esc キーで、ポインタを動かさずに消せるか。
    await page.mouse.move(probe.triggerBox.x, probe.triggerBox.y, { steps: 4 });
    await page.waitForTimeout(150);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    if (await stillVisible(probe.content.selector)) {
      findings.push({
        sc: SC.hoverContent,
        severity: "review",
        selector: probe.trigger.selector,
        message: tr(`ホバーで現れる内容 (${probe.content.selector}) が、Esc キーで消えません。ほかの内容を隠す場合は、ポインタを動かさずに消す手段が必要です。`, `Content shown on hover (${probe.content.selector}) is not dismissed by Esc. If it covers other content, a way to dismiss it without moving the pointer is required.`),
        details: { content: probe.content.selector, text: probe.content.text },
      });
    }
  }
  await page.mouse.move(0, 0);
  return { findings, found, truncated: total.all > total.picked };
}

async function probeInputs(page: Page, navigations: { url: string; method: string }[], popupCount: () => number): Promise<Finding[]> {
  const findings: Finding[] = [];
  const targets = await page.evaluate((max) => {
    const kikori = window.__kikori;
    const pick = (selector: string, kind: string): { kind: string; info: ElementInfo; mark: string }[] =>
      Array.from(document.querySelectorAll<HTMLInputElement>(selector))
        .filter((el) => !el.disabled && (kikori.isVisible(el) || (el.labels?.length ?? 0) > 0))
        .slice(0, max)
        .map((el, i) => {
          const mark = `${kind}-${i}`;
          el.setAttribute("data-kikori-probe", mark);
          return { kind, info: kikori.describe(el), mark };
        });
    return [
      ...pick("select", "select"),
      ...pick("input[type='checkbox'], input[type='radio']", "toggle"),
      ...pick("input:not([type]), input[type='text'], input[type='search'], input[type='email'], input[type='tel'], input[type='url'], input[type='number'], textarea", "text"),
    ];
  }, MAX_INPUT_TARGETS);

  for (const target of targets) {
    const navBefore = navigations.length;
    const popupBefore = popupCount();
    const urlBefore = page.url();
    // Playwright の操作は、始まったページ移動の完了を待つ。移動は止めているので、待たずに済むようページ内で値を変える。
    const acted = await page.evaluate(
      ({ mark, kind }) => {
        const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-kikori-probe="${mark}"]`);
        if (!el) return false;
        if (kind === "select") {
          const select = el as HTMLSelectElement;
          const index = Array.from(select.options).findIndex((o, i) => i !== select.selectedIndex && !o.disabled);
          if (index < 0) return false;
          select.selectedIndex = index;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (kind === "toggle") {
          el.click();
        } else {
          el.focus();
        }
        return true;
      },
      { mark: target.mark, kind: target.kind },
    );
    if (!acted) continue;
    if (target.kind === "text") {
      await page.keyboard.type("a");
      // 多くの入力欄は、フォーカスが外れた時点で change イベントを出す。
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    }
    await page.waitForTimeout(150);

    const navigated = navigations.length > navBefore;
    const opened = popupCount() > popupBefore;
    if (navigated || opened) {
      findings.push({
        sc: SC.onInput,
        severity: "fail",
        selector: target.info.selector,
        message: tr(`値を変えただけで、${opened ? "新しいウィンドウが開きました" : `ページが ${navigations.at(-1)?.url} へ移動しようとしました`}。送信ボタンを押したときに実行するか、変化が起きることを事前に知らせてください。`, `Merely changing the value ${opened ? "opened a new window" : `tried to move the page to ${navigations.at(-1)?.url}`}. Run this when a submit button is pressed, or tell users beforehand that the change will happen.`),
        details: { text: target.info.text, ...(navigated ? { movedTo: navigations.at(-1) } : {}) },
      });
    } else if (page.url().split("#")[0] !== urlBefore.split("#")[0]) {
      findings.push({
        sc: SC.onInput,
        severity: "review",
        selector: target.info.selector,
        message: tr(`値を変えただけで、URL が ${page.url()} に変わりました。画面の内容が大きく入れ替わる場合は、事前に知らせているか確認してください。`, `Merely changing the value changed the URL to ${page.url()}. If the content of the page changes substantially, check that users are told beforehand.`),
        details: { text: target.info.text, url: page.url() },
      });
    }
  }
  return findings;
}

/** ブラウザ側で実行する。外側の変数は参照できない。 */
function collectStatic(): StaticReport {
  const kikori = window.__kikori;

  const parse = (value: string): [number, number, number, number] | null => {
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
    if (!m) return null;
    const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [Number(m[1]), Number(m[2]), Number(m[3]), alpha];
  };
  const luminance = ([r, g, b]: [number, number, number, number]): number => {
    const channel = (v: number): number => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a: [number, number, number, number], b: [number, number, number, number]): number => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };
  /** 透明でない背景を持つ、いちばん近い祖先の色。半透明や画像の背景は判定できないので null を返す。 */
  const backgroundOf = (start: Element | null): [number, number, number, number] | null => {
    for (let cur = start; cur; cur = cur.parentElement) {
      const style = getComputedStyle(cur);
      if (style.backgroundImage !== "none") return null;
      const color = parse(style.backgroundColor);
      if (!color) return null;
      if (color[3] === 0) continue;
      return color[3] === 1 ? color : null;
    }
    return [255, 255, 255, 1];
  };

  const lowContrastControls: StaticReport["lowContrastControls"] = [];
  const TEXT_FIELDS = "input:not([type]), input[type='text'], input[type='search'], input[type='email'], input[type='tel'], input[type='url'], input[type='number'], input[type='password'], input[type='date'], select, textarea";
  for (const el of document.querySelectorAll<HTMLInputElement>(TEXT_FIELDS)) {
    if (el.disabled || !kikori.isVisible(el)) continue;
    const style = getComputedStyle(el);
    // 影や輪郭線で境界を示している場合は、ここでは判定しない。
    if (style.boxShadow !== "none" || style.outlineStyle !== "none") continue;
    const around = backgroundOf(el.parentElement);
    const own = backgroundOf(el);
    if (!around || !own) continue;
    const candidates: { color: [number, number, number, number]; label: string }[] = [{ color: own, label: style.backgroundColor }];
    for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
      if (style[`border${side}Style`] === "none" || parseFloat(style[`border${side}Width`]) === 0) continue;
      const color = parse(style[`border${side}Color`]);
      if (color && color[3] === 1) candidates.push({ color, label: style[`border${side}Color`] });
    }
    const best = candidates.map((c) => ({ ...c, ratio: ratio(c.color, around) })).sort((a, b) => b.ratio - a.ratio)[0]!;
    if (best.ratio < 3) {
      lowContrastControls.push({ ...kikori.describe(el), ratio: best.ratio, boundary: best.label, background: `rgb(${around.slice(0, 3).join(", ")})` });
    }
  }

  const fastAnimations: StaticReport["fastAnimations"] = [];
  const FLASHING = ["opacity", "visibility", "backgroundColor", "color", "filter"];
  for (const animation of document.getAnimations()) {
    const effect = animation.effect;
    if (animation.playState !== "running" || !(effect instanceof KeyframeEffect) || !effect.target) continue;
    const timing = effect.getComputedTiming();
    const period = Number(timing.duration);
    const repeats = timing.iterations === Infinity || Number(timing.iterations) >= 3;
    if (!repeats || !(period > 0) || period >= 334) continue;
    if (!effect.getKeyframes().some((frame) => FLASHING.some((prop) => prop in frame))) continue;
    if (kikori.isVisible(effect.target)) fastAnimations.push({ ...kikori.describe(effect.target), periodMs: period });
  }

  const LIVE = "[role='status'], [role='alert'], [role='log'], [aria-live]:not([aria-live='off']), output";
  const STATUS_NAME = /(^|[-_\s])(toast|snackbar|alert|error|notification|notice|status|flash)([-_\s]|$)/i;
  const statusCandidates = Array.from(document.body.querySelectorAll("*"))
    .filter((el) => STATUS_NAME.test(`${el.id} ${typeof el.className === "string" ? el.className : ""}`))
    .filter((el) => el.closest(LIVE) === null && el.querySelector(LIVE) === null && !["INPUT", "SELECT", "TEXTAREA", "LABEL", "SCRIPT", "STYLE"].includes(el.tagName))
    .slice(0, 30)
    .map(kikori.describe);

  return {
    lowContrastControls,
    fastAnimations,
    hasFlashingMedia: document.querySelector("video, canvas, img[src$='.gif' i], img[src*='.gif?' i]") !== null,
    liveRegions: document.querySelectorAll(LIVE).length,
    statusCandidates,
    hasScriptsOrForms: document.scripts.length > 0 || document.querySelector("form, input, select, textarea") !== null,
    draggable: Array.from(document.querySelectorAll("[draggable='true']")).filter((el) => kikori.isVisible(el)).slice(0, 30).map((el) => kikori.selector(el)),
    passwordFields: Array.from(document.querySelectorAll<HTMLInputElement>("input[type='password']"))
      .filter((el) => !el.disabled)
      .map((el) => {
        // 貼り付けを取り消す処理があるかを、取り消せる paste イベントを送って確かめる。値は変わらない。
        const probe = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
        const pasteBlocked = !el.dispatchEvent(probe);
        return { ...kikori.describe(el), text: (el.labels?.[0]?.innerText ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 80), autocompleteOff: el.getAttribute("autocomplete") === "off", pasteBlocked };
      }),
    captchas: Array.from(document.querySelectorAll("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], iframe[src*='turnstile'], .g-recaptcha, .h-captcha, .cf-turnstile, [class*='captcha' i], [id*='captcha' i], img[alt*='captcha' i]"))
      .slice(0, 10)
      .map(kikori.describe),
    formControls: document.querySelectorAll("select, input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([type='image']):not([type='file']), textarea").length,
  };
}
