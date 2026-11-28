[日本語](README.ja.md) | English

# kikori-mobile

An experimental MCP server that checks the screen of an Android app against WCAG. It is the mobile companion of [kikori](https://github.com/vivil/kikori#readme), which audits web pages, and shares its success criterion numbers, statuses and judgment flow.

kikori-mobile is not affiliated with Deque Systems, axe-core or Google.

> **Experimental.** The checks have been tested against saved screen hierarchies, not yet against a wide range of real apps. Expect the output to change.

## What it checks

| Tool | Success criteria | What it does |
|---|---|---|
| `check_android_screen` | 1.1.1 / 1.3.2 / 2.5.5 / 2.5.8 / 4.1.2 | Reads the screen shown on an Android emulator or device and detects unnamed controls, small touch targets and reading-order mismatches |

The tool reads the accessibility hierarchy through UI Automator and reports:

- actionable elements that have no name for a screen reader (1.1.1 for images, 4.1.2 otherwise),
- touch targets smaller than 24dp that are also too close to a neighbour (2.5.8), and smaller than 44dp (2.5.5, Level AAA). A small target that sits inside a line of text is reported for review, because the inline exception may apply,
- elements whose order in the hierarchy differs from their position on screen (1.3.2, for review).

It also returns the reading order and the images without a name, so that the calling model can judge them. Targets below the 48dp that the Android guidelines recommend are not WCAG failures; they are listed separately in `data.platformGuidelines`, with the platform and the source of the guideline. Success criterion numbers, statuses and `judgments` work as they do for web pages.

## Getting started

You need:

- Node.js 22 or later,
- `adb` from the Android SDK Platform-Tools on the `PATH`,
- one emulator, or one device with USB debugging allowed.

```sh
claude mcp add kikori-mobile -- npx -y kikori-mobile
```

Open the screen you want to check on the device, then ask the agent to run `check_android_screen`.

## Startup options

| Option | Environment variable | Meaning |
|---|---|---|
| `--lang <ja\|en>` | `KIKORI_LANG` | Language for results and errors. Defaults to the system locale |
| `--serial <id>` | `KIKORI_ANDROID_SERIAL` | Serial of the device to check, as shown by `adb devices`. Without it, the only connected device is used |

The device is chosen when the server starts and cannot be changed through tool arguments.

## Input

| Argument | Meaning |
|---|---|
| `level` | Target conformance level: `A`, `AA` (default) or `AAA` |
| `judgments` | Judgments made by a model or a person, each as `{ id, verdict, reason, evidence }`. They work as in kikori |
| `screenshot` | Attach a screenshot of the device. Default `false` |

## Output

The result has the same shape as a kikori check result: `findings` with a success criterion, a severity (`fail` or `review`) and a message, the criteria that were `checked`, and the criteria that `needsJudgment`. It adds:

- `criteria`: the status of each criterion this check covers,
- `coreVersion`: the version of the shared core that defines the criteria and statuses,
- `data.readingOrder`: the elements in the order a screen reader is estimated to read them,
- `data.unnamedImages`: images without a name that are not actionable, which may be decorative,
- `data.platformGuidelines`: targets below a platform guideline, with the platform and the source,
- `data.framework`: the framework the screen appears to be built with, and `readingOrderConfidence`,
- `notes`: what was not checked.

A result with no findings is not proof of conformance. Have a person verify with TalkBack before claiming it.

## Limits

- kikori only reads from the device: the hierarchy, the screen density and, when asked, a screenshot. It does not tap, type or change settings.
- Only the visible screen is checked. Items of a scrollable area that are off screen do not appear in the hierarchy; the result says so in `notes` when the screen has a scrollable area. The inside of a WebView may be missing.
- The reading order is estimated from the order of the hierarchy. TalkBack also takes the position on screen and the app's own traversal settings into account, so the order a user hears can differ.
- The estimate is less reliable for screens built with Jetpack Compose, Flutter, React Native or a WebView, which decide the reading order themselves. kikori guesses the framework from the hierarchy and returns it in `data.framework` with `readingOrderConfidence`.
- The checks have been tested against saved hierarchies. They have not yet been run against a wide range of real apps.
- iOS is not supported yet.

## Development

This package lives in the kikori repository and compiles the shared core in `packages/core` into its own output.

```sh
npm ci                                   # at the repository root
npm test --workspace kikori-mobile
```

The tests use saved hierarchies and a stand-in for `adb`, so they need neither a device nor the Android SDK.

## License

[MIT](LICENSE)
