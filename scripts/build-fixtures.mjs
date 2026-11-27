// テスト用のサンプルアプリ (React / Vue / Angular) を、ブラウザで直接読める 1 つのファイルにまとめる。
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const path = (relative) => new URL(relative, root).pathname;

await build({
  entryPoints: {
    react: path("fixtures-src/frameworks/react.jsx"),
    vue: path("fixtures-src/frameworks/vue.js"),
    angular: path("fixtures-src/frameworks/angular.ts"),
  },
  outdir: path("test/fixtures/frameworks/dist"),
  bundle: true,
  format: "iife",
  minify: true,
  jsx: "automatic",
  logLevel: "warning",
  define: {
    "process.env.NODE_ENV": '"production"',
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
    ngDevMode: "false",
    ngJitMode: "true",
  },
  // Angular のデコレータは、TypeScript の従来の方式で変換する。
  tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
});
