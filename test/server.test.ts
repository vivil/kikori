import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = fileURLToPath(new URL("../src/index.js", import.meta.url));
const fixture = (name: string): string => new URL(`../../test/fixtures/${name}`, import.meta.url).href;

test("MCP クライアントからツールの一覧を取得し、検査を呼び出せる", async () => {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env: process.env as Record<string, string> }));
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "audit_page",
      "audit_site",
      "capture_screenshot",
      "check_axe",
      "check_interaction",
      "check_keyboard_focus",
      "check_presentation",
      "check_reflow",
      "check_text_spacing",
      "collect_evidence",
    ]);

    const result = await client.callTool({ name: "check_reflow", arguments: { url: fixture("reflow-bad.html") } });
    const content = result.content as { type: string; text: string }[];
    const parsed = JSON.parse(content[0]!.text);
    assert.equal(parsed.check, "reflow");
    assert.ok(parsed.summary.fail >= 1);

    const rejected = await client.callTool({ name: "check_reflow", arguments: { url: "javascript:alert(1)" } });
    assert.equal(rejected.isError, true);

    const audit = await client.callTool({ name: "audit_page", arguments: { url: fixture("good.html") } });
    const auditParsed = JSON.parse((audit.content as { text: string }[])[0]!.text);
    assert.deepEqual(auditParsed.summary, { fail: 0, review: 0 });
    assert.equal(auditParsed.conformance.verdict, "undetermined");
    assert.equal(auditParsed.results.length, 6);

    const evidence = await client.callTool({ name: "collect_evidence", arguments: { url: fixture("good.html"), criteria: ["2.4.6"] } });
    const parts = evidence.content as { type: string; mimeType?: string }[];
    assert.equal(parts.at(-1)?.type, "image");
    assert.equal(parts.at(-1)?.mimeType, "image/jpeg");
  } finally {
    await client.close();
  }
});
