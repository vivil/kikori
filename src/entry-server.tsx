import { renderToString } from "react-dom/server";
import { App } from "./App";
import type { Locale } from "./content";

/** Renders the page to HTML at build time, so that it can be read without JavaScript. */
export function render(locale: Locale): string {
  return renderToString(<App locale={locale} />);
}
