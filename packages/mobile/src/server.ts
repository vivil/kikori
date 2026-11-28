import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAndroidTools } from "./android/tools.js";

/** package.json に書かれたバージョン。ビルドした場所からの相対位置で読む。 */
export function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

/** ツールの説明文は、起動時に決めた言語で作る。そのため、サーバーを作る時点で組み立てる。 */
export function createServer(): McpServer {
  const server = new McpServer({ name: "kikori-mobile", version: packageVersion() });
  // プラットフォームごとの道具は、それぞれのディレクトリの中で登録する。
  // ほかのプラットフォームを足すときも、ここからはその入口だけを呼ぶ。
  registerAndroidTools(server);
  return server;
}
