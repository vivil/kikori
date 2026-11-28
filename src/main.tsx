import "@lily-ui/css/styles";
import "@fontsource/line-seed-jp/400.css";
import "@fontsource/line-seed-jp/700.css";
import "@fontsource/line-seed-jp/800.css";
import "./theme.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { Locale } from "./content";

const locale: Locale = document.documentElement.lang === "ja" ? "ja" : "en";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App locale={locale} />
  </StrictMode>,
);
