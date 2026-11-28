#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configure, getSettings, parseArgs, usage } from "./config.js";
import { createServer } from "./server.js";

// 標準出力は MCP の通信に使うので、人に向けた文章は標準エラーに出す。
try {
  const { settings, help } = parseArgs(process.argv.slice(2));
  if (help) {
    console.error(usage(settings.lang));
    process.exit(0);
  }
  configure(settings);
} catch (error) {
  console.error(`${error instanceof Error ? error.message : String(error)}\n\n${usage(getSettings().lang)}`);
  process.exit(2);
}

const server = createServer();
await server.connect(new StdioServerTransport());
