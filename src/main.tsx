import "@lily-ui/css/styles";
import "./theme.css";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { App } from "./App";
import type { Locale } from "./content";

const locale: Locale = document.documentElement.lang === "ja" ? "ja" : "en";
hydrateRoot(
  document.getElementById("root")!,
  <StrictMode>
    <App locale={locale} />
  </StrictMode>,
);
