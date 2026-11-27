<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/kikori-logo-dark.svg">
    <img src="assets/kikori-logo-light.svg" alt="" width="320">
  </picture>
</p>

# kikori

English | [日本語](README.ja.md)

Kikori (木こり, "lumberjack") is an MCP server that audits WCAG 2.2 success criteria by driving a real browser. It can audit against WCAG 2.1 as well.
When an agent such as Claude Code calls it, findings come back with the success criterion number and a CSS selector, so the agent can go straight to the fix.

For criteria that cannot be decided mechanically, kikori returns evidence and screenshots and lets the calling model judge. Automated checks and model judgments together reach a conclusion for every success criterion.

The name comes from the lumberjack who swings the axe: kikori uses axe-core as one of its tools and goes on to check what axe alone cannot reach. It is not an official product of Deque Systems or of axe-core.

## What it checks

| Tool | Success criteria | What it does |
|---|---|---|
| `audit_site` | All of WCAG 2.2 or 2.1 | Audits several pages and compares them for consistency |
| `audit_page` | All of WCAG 2.2 or 2.1 | Runs every check below and returns a status for each success criterion |
| `check_axe` | Criteria covered by axe-core | Detects problems with text alternatives, contrast, labels, ARIA, language declarations and more |
| `check_reflow` | 1.4.10 Reflow | Renders at 320px wide and detects horizontal scrolling, overflowing elements and clipped text |
| `check_text_spacing` | 1.4.12 Text Spacing | Widens line height and spacing, compares before and after, and detects clipped or overlapping text |
| `check_keyboard_focus` | 2.1.1 / 2.1.2 / 2.4.3 / 2.4.7 / 2.4.11 / 2.4.12 / 2.4.13 / 3.2.1 | Tabs through the page and checks focus order, focus indicators, obscured focus, traps and context changes on focus |
| `check_presentation` | 2.5.5 / 2.5.8 / 1.4.8 / 2.2.2 / 1.4.2 / 1.3.5 | Detects small or crowded targets, hard-to-read text layout, long-running animation, autoplaying sound and fields without autocomplete |
| `check_interaction` | 1.4.13 / 2.1.4 / 3.2.2 / 2.5.1 / 2.5.2 / 2.5.4 / 2.5.7 / 3.3.8 / 1.4.11 / 2.3.1 / 4.1.3 | Tries hover, character keys and input changes, and inspects event listeners, boundary contrast, dragging and obstacles to authentication |
| `collect_evidence` | Criteria that need a look at the content | Returns the question to answer, the failure condition, the evidence and a full-page screenshot |
| `capture_screenshot` | - | Returns a screenshot of the page or an element, for a closer look |

The audits target WCAG 2.2 by default. Pass `wcag: "2.1"` to audit against WCAG 2.1 instead. The criteria added in 2.2 that kikori checked are then returned separately in `beyondTarget` and left out of the verdict.

| Added in WCAG 2.2 | Level | How kikori handles it |
|---|---|---|
| 2.4.11 Focus Not Obscured (Minimum) | AA | Fails when the focused element is entirely hidden behind another element |
| 2.4.12 Focus Not Obscured (Enhanced) | AAA | Fails when any part of it is hidden |
| 2.4.13 Focus Appearance | AAA | Asks for review when the outline is thinner than 2px or not set |
| 2.5.7 Dragging Movements | AA | Asks for review of elements operated by dragging |
| 2.5.8 Target Size (Minimum) | AA | Fails for targets below 24 × 24px that are also too close to a neighbour |
| 3.2.6 Consistent Help | A | `audit_site` fails when help or contact links change position between pages |
| 3.3.7 Redundant Entry | A | `audit_site` asks for review when the same field appears on several pages |
| 3.3.8 Accessible Authentication (Minimum) | AA | Fails for password fields that reject paste; asks for review of `autocomplete="off"` and CAPTCHAs |
| 3.3.9 Accessible Authentication (Enhanced) | AAA | Asks for review of CAPTCHAs |

4.1.1 Parsing was removed in WCAG 2.2 and is listed only when auditing against 2.1.

## Reading audit_page

`audit_page` lists every success criterion up to the target level (`A`, `AA` or `AAA`; default `AA`) and gives each a status. For WCAG 2.2 that is 55 criteria at Level AA and 86 at AAA; for WCAG 2.1, 50 and 78.

| Status | Meaning |
|---|---|
| `fail` | A failure was found |
| `review` | Automation found spots it could not fully decide. Look at the findings and decide |
| `needs_judgment` | The content has to be looked at. `collect_evidence` gathers the material |
| `no_issue_found` | Nothing was found within what automation covers. This is not a guarantee of conformance |
| `judged_pass` | A supplied judgment says it is satisfied |
| `inapplicable` | No relevant element was found on the page, so it is presumed not to apply |
| `manual` | No material can be gathered. A person has to check |

`conformance.verdict` is one of:

- `nonconformant`: a failure was found.
- `undetermined`: no failure was found, but something is still open.
- `no_failure_found`: combining the automated checks and the supplied judgments, no failure was found in any success criterion.

## Letting the model judge

Whether a text alternative matches the image, or whether a heading describes what follows, cannot be decided mechanically. The calling model judges these criteria as follows.

1. Run `audit_page`. Criteria that need a judgment come back as `needs_judgment`.
2. Run `collect_evidence`. Each criterion comes with a question (`question`), the failure condition (`failWhen`) and the material (`evidence`), plus a full-page screenshot.
3. Use `capture_screenshot` to zoom in on an element when detail is needed.
4. Run `audit_page` again with the decisions in `judgments`.

```json
{
  "url": "http://localhost:3000/",
  "judgments": [
    { "id": "2.4.4", "verdict": "pass", "reason": "The link text alone identifies each destination" },
    { "id": "1.1.1", "verdict": "fail", "reason": "The text alternative of #hero is a file name" }
  ]
}
```

`verdict` is `pass`, `fail` or `inapplicable`. A criterion that failed an automated check stays failed even if `pass` is supplied.

`no_failure_found` is not proof of conformance. Automated checks cover a limited range and some judgments are made by a model. Have a person verify with assistive technology before claiming conformance.

`collect_evidence` returns material for these criteria:

| Success criterion | Material |
|---|---|
| 1.1.1 Non-text Content | Images with their text alternatives |
| 1.3.2 Meaningful Sequence | Text in HTML order, and places where it differs from the visual order |
| 1.3.3 Sensory Characteristics | Candidate sentences that mention shape, color, position or sound |
| 1.4.5 Images of Text | Images and background images |
| 1.4.11 Non-text Contrast | Number of icons. Field boundaries are measured by `check_interaction` |
| 2.3.1 Three Flashes or Below Threshold | Videos, GIFs and canvases |
| 2.4.4 Link Purpose (In Context) | Link text, with surrounding context for links whose text alone is unclear |
| 2.4.6 Headings and Labels | Headings and labels |
| 2.5.1 / 2.5.2 | Draggable elements. Used on pages where a framework receives events in one place |
| 4.1.3 Status Messages | Live regions and forms |

## Auditing several pages with audit_site

`audit_site` compares pages to check criteria that a single page cannot decide. It also accepts `judgments` and reflects them in the site-wide list.

| Success criterion | What is checked |
|---|---|
| 3.2.3 Consistent Navigation | Whether shared items keep the same order within `nav` elements of the same name |
| 3.2.4 Consistent Identification | Whether links to the same destination in headers, footers and navigation have different names |
| 2.4.2 Page Titled | Whether different pages share the same title |
| 2.4.5 Multiple Ways | Whether at least two of navigation, site search and a sitemap exist |
| 2.4.8 Location (AAA) | Whether there is a breadcrumb trail or `aria-current="page"` |
| 3.2.6 Consistent Help | Whether help or contact links keep the same position relative to the other repeated links |
| 3.3.7 Redundant Entry | Whether the same field appears on several pages |

There are two ways to choose the pages.

- Pass only `url` to follow same-site links on that page, up to `maxPages` (default 5, maximum 20).
- Pass a list in `urls` to audit only `url` and that list, without following links.

`criteria` in the result is the status across all pages: one failing page makes the criterion `fail`. Findings from comparing pages are in `crossPage`, and per-page findings are in `pages`.

The browser is launched seven times per page, so each page takes around five seconds.

## Getting started

Node.js 22 or later is required.

Register kikori with Claude Code. That is all.

```sh
claude mcp add kikori -- npx -y kikori
```

The first check downloads the browser kikori uses (headless Chromium, about 300 MB on disk). This happens once and takes a few seconds to a minute, depending on the network.

- On Linux, the browser may need system libraries. Install them together with the browser by running `npx kikori install --with-deps`.
- To download the browser ahead of time, for example in a container image, run `npx kikori install`.
- To forbid the automatic download, start the server with `--no-auto-install`.

The download is done by the Playwright that kikori depends on, so the browser always matches. Running `npx playwright install` yourself may fetch a browser for a different Playwright version.

### Agent skill (optional)

The repository also ships an agent skill that teaches the agent how to run an audit with kikori: which tool to call first, how to read each status, how to gather evidence and pass judgments back, and what it must not claim. Install it with the [skills CLI](https://github.com/vercel-labs/skills).

```sh
npx skills add vivil/kikori
```

The skill only adds instructions. The MCP server still has to be registered as shown above.

Then you can ask, for example:

```text
Audit http://localhost:3000/ with audit_page up to Level AA and fix the findings marked fail
```

## Startup options

The language of the results and the range that may be audited are decided when the server starts.

Results include screenshots and text from the page. So that a misled model cannot use kikori to read internal servers or local files, the range it may open is fixed at startup and cannot be changed through tool arguments.

| Option | Environment variable | Description |
|---|---|---|
| `--lang <ja\|en>` | `KIKORI_LANG` | Language for results and errors. Defaults to `ja` when the system locale is Japanese, otherwise `en` |
| `--allow-host <host>` | `KIKORI_ALLOWED_HOSTS` | Host that may be opened. Repeatable, or comma-separated. When omitted, only `localhost` and `127.0.0.1` may be opened. `*` allows every host |
| `--allow-frame-host <host>` | `KIKORI_ALLOWED_FRAME_HOSTS` | Host that iframes in the page may load. When omitted, every iframe load is blocked |
| `--file-root <path>` | `KIKORI_FILE_ROOT` | Directory that `file` URLs may be opened from. Defaults to the directory the server was started in |
| `--no-file` | `KIKORI_NO_FILE=1` | Refuse `file` URLs |
| `--storage-state <path>` | `KIKORI_STORAGE_STATE` | File holding a logged-in state. Pages are opened with its cookies and local storage |
| `--no-auto-install` | `KIKORI_NO_AUTO_INSTALL=1` | Do not download the browser automatically when it is missing |

With no options, only servers on your own machine (`localhost`, `*.localhost`, `127.0.0.1`, `[::1]`) can be audited. Auditing a site under development needs no configuration.

To audit a public site, name its host. Giving `--allow-host` replaces the default list, so list `localhost` as well if you also audit a dev server.

```sh
claude mcp add kikori -- npx -y kikori --allow-host localhost --allow-host example.com
```

Hosts can be written in three ways.

- `localhost:3000` matches that port only.
- `example.com` matches every port. It does not match subdomains.
- `*.example.com` matches subdomains. It does not match `example.com` itself.

The restriction applies in these situations.

- When the URL passed to a tool is not on the list, an error is returned without opening the page.
- When a link or script in the page tries to move to a host that is not on the list, the navigation is blocked.
- When the page tries to load an image or script from a host that is not on the list, the load is blocked.
- When a listed host redirects to another host, an error is returned instead of a result.

Images, scripts, styles and connections (fetch and WebSocket) follow the same list. Nothing is loaded from a host that is not on it.

When loads are blocked, the `notes` of the result give the destinations. A page that takes fonts or styles from a CDN is then audited looking different from what users see. Add the hosts named in `notes` to `--allow-host`.

```sh
claude mcp add kikori -- npx -y kikori --allow-host localhost --allow-host fonts.googleapis.com --allow-host fonts.gstatic.com
```

To allow every host, pass `--allow-host '*'`.

### Iframes

Every iframe load is blocked by default. If the audited page embeds an internal server in an iframe, its content would appear in the screenshots. Iframes whose content comes from the parent page itself, such as `srcdoc` or `data:`, are not blocked.

When loads are blocked, the `notes` of the result give the count and the destinations. Iframe content is not included in the checks or the screenshots.

To let iframes load, name their destinations with `--allow-frame-host`.

- `self` allows iframes on the same host as the audited page.
- `player.example.com` or `*.example.com` allows iframes on that host. The syntax is the same as `--allow-host`.
- `*` allows every iframe.

```sh
claude mcp add kikori -- npx -y kikori --allow-host localhost:3000 --allow-frame-host self
```

`--allow-frame-host` is a separate list from `--allow-host`. Allowing a video host as an iframe does not make that host auditable directly.

Only `.html`, `.htm` and `.xhtml` files inside the allowed directory may be opened through `file` URLs.

### Pages behind a login

To audit pages that need a login, save a logged-in state to a file and pass it with `--storage-state`. The file uses Playwright's storageState format: cookies and local storage.

One way to create it is Playwright's code generator. It opens a browser; log in there, then close the window.

```sh
npx playwright codegen --save-storage=auth.json https://app.example.com/login
```

Then start kikori with the file and the host.

```sh
claude mcp add kikori -- npx -y kikori --allow-host app.example.com --storage-state /path/to/auth.json
```

Keep the following in mind.

- The file holds session cookies. Treat it like a password and keep it out of version control.
- Use a test account. Results contain the text and screenshots of what that account can see, and they are handed to the model.
- Only cookies and local storage that belong to a host listed in `--allow-host` are loaded. The rest of the file is ignored.
- The session can be used to act as that account. While `check_interaction` tries key presses, hover and input changes with a login state loaded, it blocks every request and closes open WebSockets, so nothing can be triggered with the account's rights. Hover content that is fetched over the network is not detected in that mode.
- A site that changes state when a page is merely loaded with GET can still be affected.
- kikori reads the file and never updates it. When the session expires, pages redirect to the login screen again; create the file anew.

## Input

Every tool requires `url`, which may be an `http`, `https` or `file` URL.

| Argument | Tools | Description |
|---|---|---|
| `url` | All | URL of the page to check |
| `waitForSelector` | All | After load, wait until this element appears. Use it to wait for an SPA to render |
| `waitMs` | All | Extra time to wait after load, in milliseconds |
| `urls` / `maxPages` | `audit_site` | Pages to audit, and the maximum number of pages |
| `level` | `audit_site`, `audit_page`, `check_axe` | Target conformance level (`A`, `AA`, `AAA`). Default `AA` |
| `wcag` | `audit_site`, `audit_page`, `check_axe` | WCAG version (`2.2` or `2.1`). Default `2.2` |
| `judgments` | `audit_site`, `audit_page` | Judgments made by a model or a person |
| `criteria` / `screenshot` | `collect_evidence` | Criteria to gather material for, and whether to attach a screenshot |
| `selector` / `fullPage` | `capture_screenshot` | Element to capture, and whether to capture the full page |
| `width` / `height` | Individual checks | Viewport size. Default 320 × 256 for reflow, 1280 × 720 otherwise |
| `maxSteps` | `check_keyboard_focus` | Maximum number of Tab presses. Default 150 |

## Output

Results are JSON. Individual checks return findings in this shape.

```json
{
  "check": "reflow",
  "url": "http://localhost:3000/",
  "viewport": { "width": 320, "height": 256 },
  "summary": { "fail": 1, "review": 0 },
  "checked": ["1.4.10"],
  "findings": [
    {
      "sc": { "id": "1.4.10", "name": "Reflow", "level": "AA", "since": "2.1" },
      "severity": "fail",
      "selector": "#wide",
      "message": "Overflows the right edge by 580px at 320px wide and makes the page scroll horizontally.",
      "details": { "overflowPx": 580, "text": "A region with a fixed width.", "viewportWidth": 320 }
    }
  ]
}
```

There are two severities.

- `fail`: a failure confirmed mechanically.
- `review`: a spot that needs a human decision. This includes cases that may be exempt, such as an overflowing table.

`check_keyboard_focus` returns the focus order in `data.sequence`. Use it to judge whether the order makes sense.

## How the checks work, and their limits

- Reflow compares 320px wide against a 1280px baseline. Text that is already clipped at the baseline is not reported.
- Text spacing compares before and after the style override. Text that already overlaps is not reported.
- Focus indicators are detected by comparing a screenshot taken while focused with one taken right after blurring. Because focus is removed once along the way, results can be off on pages that show a validation error on `blur`.
- Iframe loads are blocked by default. Even when allowed with `--allow-frame-host`, elements inside iframes are outside the axe and focus checks.
- Line length is an estimate that counts a CJK character as 1em and a Latin character as 0.5em.
- `audit_page` works on one page. Criteria that compare pages, such as 3.2.3 and 3.2.4, come back as `manual`; use `audit_site` for those.
- `audit_site` follows only the links on the start page. Screens that appear after an action cannot be audited. Pages behind a login need `--storage-state`.
- When auditing against WCAG 2.1, 4.1.1 is treated as always satisfied for HTML content, per the WCAG 2.1 errata.
- The checks for the criteria added in WCAG 2.2 are heuristics. 2.4.13 is judged from the `outline` style, not from the pixels of the indicator. 3.3.8 looks for password fields and common CAPTCHA markup, and does not follow a login flow.
- When a page has no media or no form fields, the related criteria are presumed not to apply. Elements loaded later may be missed.
- `check_interaction` blocks navigation requests and non-GET requests while it operates the page. It does not change data on the server, but a site that changes state on GET may still be affected.
- Hover content is detected only if it appears within 250 milliseconds. Native tooltips from the `title` attribute are out of scope.
- Detection of framework event handlers has been verified with React, Vue and Angular samples. React receives events in one place, so handlers are read from internal properties on the elements. With a framework built the same way whose properties cannot be read, 2.5.1 and 2.5.2 become `needs_judgment`.
- Pointer handlers registered directly on `window` are not detected, because they cannot be told apart from the ones Playwright registers there.
- Checks run in Chromium only.
- Zero findings is not a guarantee that a criterion is satisfied. Finish with human eyes and assistive technology.

## Development

To work on kikori itself, build it from source.

```sh
npm install
npm run build
node dist/src/index.js install
npm test
```

To try a local build from Claude Code, register it with `claude mcp add kikori-dev -- node /path/to/kikori/dist/src/index.js`.

`test/fixtures` holds pages with and without problems.

`fixtures-src/frameworks` holds samples with the same defects written in React, Vue and Angular. `npm test` bundles them with esbuild and checks that all three produce the same findings.

Every pull request and every push to `main` runs the same tests in GitHub Actions.

Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org) with the types of the Angular convention: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style` and `test`. GitHub Actions checks them with commitlint. To check locally, run `npx commitlint --from main`.

## Releasing

1. Update `version` in `package.json` (for example with `npm version minor`) and merge the change into `main`.
2. Publish a GitHub release whose tag is `v` followed by that version, such as `v0.2.0`.
3. The release workflow runs the tests and publishes the package to npm.

The workflow authenticates with npm trusted publishing, so no npm token is stored in the repository. It stops if the tag does not match the version in `package.json`.

## Roadmap

- Tools that check reading order and labels in iOS and Android apps.
- Detection of misreadings that are common when Japanese text is read aloud.

## License

[MIT](LICENSE)
