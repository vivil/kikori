import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tr } from "../../../core/src/i18n.js";
import { limitToLevel, summarizeCriteria } from "../../../core/src/summary.js";
import { CORE_VERSION } from "../../../core/src/version.js";
import { getSettings } from "../config.js";
import { checkAndroidScreen } from "./checks.js";
import { adbDevice } from "./device.js";

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** Android の検査の道具を、サーバーに登録する。 */
export function registerAndroidTools(server: McpServer): void {
  const level = z
    .enum(["A", "AA", "AAA"])
    .optional()
    .describe(tr("目標とする適合レベル。既定値は AA。", "Target conformance level. Default AA."));
  const judgments = z
    .array(
      z.object({
        id: z.string().describe(tr("達成基準の番号 (例: 1.3.2)", "Success criterion number, e.g. 1.3.2")),
        verdict: z
          .enum(["pass", "fail", "inapplicable", "unsure"])
          .describe(tr("pass: 満たしている / fail: 不適合 / inapplicable: 該当する内容がない / unsure: 材料だけでは決められない", "pass: satisfied / fail: not satisfied / inapplicable: no relevant content / unsure: the material is not enough to decide")),
        reason: z.string().describe(tr("判断の根拠。何を見てそう判断したかを書く。", "Grounds for the judgment: what you looked at and why you decided so.")),
        evidence: z
          .string()
          .optional()
          .describe(tr("fail のときは必須。根拠にした要素か文言。省くと要確認として扱われる。", "Required for fail: the element or the text the judgment relies on. Without it the judgment is treated as a review item.")),
      }),
    )
    .optional()
    .describe(tr("結果の材料を見て下した判断。渡すと達成基準の一覧に反映される。", "Judgments made from the material in the result. They are reflected in the criteria list."));

  server.registerTool(
    "check_android_screen",
    {
      title: tr("Android の画面の検査 (試験的、WCAG 1.1.1 / 1.3.2 / 2.5.5 / 2.5.8 / 4.1.2)", "Android screen check (experimental, WCAG 1.1.1 / 1.3.2 / 2.5.5 / 2.5.8 / 4.1.2)"),
      description: tr(
        "試験的な機能。adb でつながっている Android のエミュレーターか実機から、いま表示されている画面の階層を読み取って検査する。名前のない操作部品、小さすぎるタッチターゲット、階層の順序と画面上の位置の食い違いを検出する。data.readingOrder に読み上げの順序の一覧を返すので、意味が通るかはそれを見て判断する。検査するのは表示中の画面だけで、端末の操作や設定の変更は行わない。調べたい画面は、先に端末で開いておく。",
        "Experimental. Reads the hierarchy of the screen currently shown on an Android emulator or device connected through adb, and checks it. Detects actionable elements without a name, touch targets that are too small, and mismatches between hierarchy order and position on screen. data.readingOrder lists the reading order so you can judge whether it makes sense. Only the visible screen is checked, and the device is neither operated nor reconfigured. Open the screen you want to check on the device first.",
      ),
      inputSchema: {
        level,
        judgments,
        screenshot: z.boolean().optional().describe(tr("スクリーンショットを付けるか。既定値は false。", "Whether to attach a screenshot. Default false.")),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args): Promise<{ content: Content[]; isError?: boolean }> => {
      try {
        const device = adbDevice(getSettings().serial);
        const target = args.level ?? "AA";
        const result = limitToLevel(await checkAndroidScreen(device), target);
        // 達成基準の番号と状態は、ウェブの検査と同じものを使う。返すのは、この検査が調べた達成基準だけ。
        const touched = new Set([...result.checked, ...(result.needsJudgment ?? [])]);
        const criteria = summarizeCriteria([result], target, args.judgments).criteria.filter((row) => touched.has(row.id));
        const content: Content[] = [{ type: "text", text: JSON.stringify({ coreVersion: CORE_VERSION, ...result, criteria }, null, 2) }];
        if (args.screenshot) {
          content.push({ type: "text", text: tr("スクリーンショット: 端末の画面", "Screenshot: device screen") }, { type: "image", data: (await device.screenshot()).toString("base64"), mimeType: "image/png" });
        }
        return { content };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: tr(`実行できませんでした: ${message}`, `Could not run: ${message}`) }], isError: true };
      }
    },
  );
}
