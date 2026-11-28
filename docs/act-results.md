# ACT Rules benchmark

How axe-core on its own and kikori compare with the expected outcomes of the [W3C ACT Rules test cases](https://www.w3.org/WAI/standards-guidelines/act/rules/).

- Generated: 2026-11-27, with kikori 0.3.0 and axe-core 4.14.1
- Source: https://www.w3.org/WAI/content-assets/wcag-act-rules/testcases.json (1211 test cases)
- Reproduce: `npm run benchmark:act`. The raw numbers are in [act-results.json](act-results.json).

## Result

955 test cases from 63 rules, of which 303 are expected to fail.

| | axe-core alone | kikori, automatic checks | kikori with a model's judgment |
|---|---|---|---|
| Rules covered | 37 | 43 | 56 |
| Expected failures reported as failures | 162 | 179 | 225 |
| Expected failures only flagged for review | 15 | 32 | 35 |
| Expected failures missed | 126 | 92 | 43 |
| False alarms | 0 | 1 | 7 |
| Precision | 100.0% | 99.4% | 97.0% |
| Recall | 53.5% | 59.1% | 74.3% |
| Recall counting review flags | 58.4% | 69.6% | 85.8% |
| Test cases that could not be run | 4 | 0 | 0 |

The first two columns are fully automatic and anyone can reproduce them. The third adds the step kikori is designed around: the calling model judges the criteria that need a judgment about meaning, from the evidence kikori collects.

### How the third column was produced

- Claude was the judging model, run as a separate agent. It judged 217 test cases from 14 rules. It was given only what `collect_evidence` returns, including its instructions, and screenshots where the criterion is visual.
- The expected outcomes were hidden. The page titles, which give them away, were masked, and the cases were ordered by test case id.
- The judgment follows kikori's rules: a failing judgment has to point to the evidence it relies on, and the model answers unsure when the material is not enough. An unsure answer counts as flagged for review, not as a failure.
- The judgments are in [act-judgments.json](act-judgments.json), and `scripts/act-judge-sheet.mjs` prepares the same material for another model or a person.
- A model's judgment is not reproducible in the way the automatic columns are. Another model, or the same model on another day, will give different numbers. Read the column as one measured run.
- The judgment costs some precision. The judged failures include false alarms that the automatic checks do not have, most of them on the two rules about links with identical names, where deciding whether two destinations serve the same purpose is itself a judgment. Treat a judged failure as a finding to confirm, not a verdict.
- Those two rules also remain the weakest: the judgment reported 3 of their 14 expected failures.
- Rules about captions, audio description and transcripts were not judged, because that needs watching and listening to the media.

## Method and limits

- Only rules that map to a WCAG success criterion for conformance are evaluated. 245 test cases belong to rules without one, and 11 are not HTML pages; both groups are skipped.
- Results are matched by rule. A finding counts for a rule only when it comes from a check that implements that rule: for axe-core, the rules that list the ACT rule in their own metadata; for kikori's own checks, the mapping in `scripts/act-benchmark.mjs`.
- "axe-core alone" is axe-core as shipped, with its default rules. kikori runs axe-core with a few experimental rules enabled and adds its own checks.
- A tool with no check for a rule reports nothing for that rule's test cases, which counts as missing every expected failure.
- Precision is the share of reported failures that were expected. Recall is the share of expected failures that were reported as failures.
- The pages are served from a local HTTP server rather than over HTTPS from www.w3.org.
- This is not a formal ACT implementation report and must not be presented as one.
- The ACT rules mostly cover what can be checked from a page's markup. Checks that kikori performs by operating the page, such as reflow, text spacing after an override, hover content or comparisons between pages, have few or no ACT rules and are barely measured here.

## Per rule

Each cell gives failures found / flagged for review / false alarms. A dash means the rule is not covered.

| Rule | Success criteria | Expected failures | axe-core alone | kikori, automatic | kikori with judgment |
|---|---|---|---|---|---|
| [Image has non-empty accessible name](https://www.w3.org/WAI/standards-guidelines/act/rules/23a2a8/) | 1.1.1 | 5 | 5 / 0 / 0 | 5 / 0 / 0 | 5 / 0 / 0 |
| [Image button has non-empty accessible name](https://www.w3.org/WAI/standards-guidelines/act/rules/59796f/) | 1.1.1, 4.1.2 | 3 | 3 / 0 / 0 | 3 / 0 / 0 | 3 / 0 / 0 |
| [SVG element with explicit role has non-empty accessible name](https://www.w3.org/WAI/standards-guidelines/act/rules/7d6734/) | 1.1.1 | 4 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| [Object element rendering non-text content has non-empty accessible name](https://www.w3.org/WAI/standards-guidelines/act/rules/8fc3b6/) | 1.1.1 | 6 | 6 / 0 / 0 | 6 / 0 / 0 | 6 / 0 / 0 |
| [Image not in the accessibility tree is decorative](https://www.w3.org/WAI/standards-guidelines/act/rules/e88epe/) | 1.1.1 | 5 | - | - | 3 / 2 / 1 |
| [Image accessible name is descriptive](https://www.w3.org/WAI/standards-guidelines/act/rules/qt1vmo/) | 1.1.1 | 3 | - | - | 3 / 0 / 0 |
| [Video element visual-only content has accessible alternative](https://www.w3.org/WAI/standards-guidelines/act/rules/c3232f/) | 1.2.1 | 4 | - | - | - |
| [Audio element content has text alternative](https://www.w3.org/WAI/standards-guidelines/act/rules/e7aa44/) | 1.2.1 | 2 | - | - | - |
| [Video element auditory content has accessible alternative](https://www.w3.org/WAI/standards-guidelines/act/rules/eac66b/) | 1.2.2 | 2 | 0 / 2 / 0 | 0 / 2 / 0 | 0 / 2 / 0 |
| [Video element visual content has accessible alternative](https://www.w3.org/WAI/standards-guidelines/act/rules/c5a4ea/) | 1.2.3 | 4 | - | - | - |
| [Video element visual content has strict accessible alternative](https://www.w3.org/WAI/standards-guidelines/act/rules/1ec09b/) | 1.2.5 | 3 | - | - | - |
| [Audio and visuals of video element have transcript](https://www.w3.org/WAI/standards-guidelines/act/rules/1a02b0/) | 1.2.8 | 4 | - | - | - |
| [Headers attribute specified on a cell refers to cells in the same table element](https://www.w3.org/WAI/standards-guidelines/act/rules/a25f45/) | 1.3.1 | 4 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| [ARIA required owned elements](https://www.w3.org/WAI/standards-guidelines/act/rules/bc4a75/) | 1.3.1 | 10 | 9 / 0 / 0 | 9 / 0 / 0 | 9 / 0 / 0 |
| [Table header cell has assigned cells](https://www.w3.org/WAI/standards-guidelines/act/rules/d0f69e/) | 1.3.1 | 3 | 0 / 2 / 0 | 0 / 2 / 0 | 0 / 2 / 0 |
| [ARIA required context role](https://www.w3.org/WAI/standards-guidelines/act/rules/ff89c9/) | 1.3.1 | 4 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| [Content has alternative for visual reference](https://www.w3.org/WAI/standards-guidelines/act/rules/9bd38c/) | 1.3.3 | 4 | - | - | 3 / 1 / 0 |
| [Orientation of the page is not restricted using CSS transforms](https://www.w3.org/WAI/standards-guidelines/act/rules/b33eff/) | 1.3.4 | 4 | 0 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| [`autocomplete` attribute has valid value](https://www.w3.org/WAI/standards-guidelines/act/rules/73f2c2/) | 1.3.5 | 10 | 10 / 0 / 0 | 10 / 0 / 0 | 10 / 0 / 0 |
| [Audio or video element avoids automatically playing audio](https://www.w3.org/WAI/standards-guidelines/act/rules/80f0bf/) | 1.4.2 | 2 | 0 / 2 / 0 | 1 / 1 / 0 | 1 / 1 / 0 |
| [Text has minimum contrast](https://www.w3.org/WAI/standards-guidelines/act/rules/afw4f7/) | 1.4.3 | 11 | 8 / 3 / 0 | 8 / 3 / 0 | 8 / 3 / 0 |
| [Zoomed text node is not clipped with CSS overflow](https://www.w3.org/WAI/standards-guidelines/act/rules/59br37/) | 1.4.4 | 5 | - | 0 / 5 / 0 | 0 / 5 / 0 |
| [Meta viewport allows for zoom](https://www.w3.org/WAI/standards-guidelines/act/rules/b4f0c3/) | 1.4.4 | 7 | 7 / 0 / 0 | 7 / 0 / 0 | 7 / 0 / 0 |
| [HTML images contain no text](https://www.w3.org/WAI/standards-guidelines/act/rules/0va7u6/) | 1.4.5, 1.4.9 | 5 | - | - | 5 / 0 / 0 |
| [Text has enhanced contrast](https://www.w3.org/WAI/standards-guidelines/act/rules/09o5cg/) | 1.4.6 | 13 | 1 / 3 / 0 | 10 / 3 / 0 | 10 / 3 / 0 |
| [Important letter spacing in style attributes is wide enough](https://www.w3.org/WAI/standards-guidelines/act/rules/24afc2/) | 1.4.12 | 4 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| [Important line height in style attributes is wide enough](https://www.w3.org/WAI/standards-guidelines/act/rules/78fd32/) | 1.4.12 | 6 | 6 / 0 / 0 | 6 / 0 / 0 | 6 / 0 / 0 |
| [Important word spacing in style attributes is wide enough](https://www.w3.org/WAI/standards-guidelines/act/rules/9e45ec/) | 1.4.12 | 4 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| [Scrollable content can be reached with sequential focus navigation](https://www.w3.org/WAI/standards-guidelines/act/rules/0ssw9k/) | 2.1.1, 2.1.3 | 2 | 2 / 0 / 0 | 2 / 0 / 0 | 2 / 0 / 0 |
| [Iframe with interactive elements is not excluded from tab-order](https://www.w3.org/WAI/standards-guidelines/act/rules/akn7bn/) | 2.1.1 | 1 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| [Focusable element has no keyboard trap](https://www.w3.org/WAI/standards-guidelines/act/rules/80af7b/) | 2.1.2 | 5 | - | 0 / 5 / 0 | 0 / 5 / 0 |
| [No keyboard shortcut uses only printable characters](https://www.w3.org/WAI/standards-guidelines/act/rules/ffbc54/) | 2.1.4 | 2 | - | 0 / 0 / 0 | 0 / 0 / 0 |
| [Meta element has no refresh delay](https://www.w3.org/WAI/standards-guidelines/act/rules/bc659a/) | 2.2.1 | 4 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| [Text content that changes automatically can be paused, stopped or hidden](https://www.w3.org/WAI/standards-guidelines/act/rules/efbfc7/) | 2.2.2 | 1 | - | - | - |
| [Meta element has no refresh delay (no exception)](https://www.w3.org/WAI/standards-guidelines/act/rules/bisz58/) | 2.2.4, 3.2.5 | 3 | 1 / 0 / 0 | 3 / 0 / 0 | 3 / 0 / 0 |
| [Bypass Blocks of Repeated Content](https://www.w3.org/WAI/standards-guidelines/act/rules/cf77f2/) | 2.4.1 | 1 | 0 / 1 / 0 | 0 / 1 / 0 | 0 / 1 / 0 |
| [HTML page has non-empty title](https://www.w3.org/WAI/standards-guidelines/act/rules/2779a5/) | 2.4.2 | 6 | 6 / 0 / 0 | 6 / 0 / 0 | 6 / 0 / 0 |
| [HTML page title is descriptive](https://www.w3.org/WAI/standards-guidelines/act/rules/c4a8a4/) | 2.4.2 | 3 | - | - | 3 / 0 / 0 |
| [Link in context is descriptive](https://www.w3.org/WAI/standards-guidelines/act/rules/5effbb/) | 2.4.4 | 6 | - | - | 6 / 0 / 0 |
| [Link has non-empty accessible name](https://www.w3.org/WAI/standards-guidelines/act/rules/c487ae/) | 2.4.4, 4.1.2 | 11 | 11 / 0 / 0 | 11 / 0 / 0 | 11 / 0 / 0 |
| [Links with identical accessible names and same context serve equivalent purpose](https://www.w3.org/WAI/standards-guidelines/act/rules/fd3a94/) | 2.4.4 | 8 | - | - | 1 / 2 / 3 |
| [Heading is descriptive](https://www.w3.org/WAI/standards-guidelines/act/rules/b49b2e/) | 2.4.6 | 4 | - | - | 3 / 0 / 0 |
| [Form field label is descriptive](https://www.w3.org/WAI/standards-guidelines/act/rules/cc0f0a/) | 2.4.6 | 6 | - | - | 4 / 0 / 0 |
| [Element in sequential focus order has visible focus](https://www.w3.org/WAI/standards-guidelines/act/rules/oj04fd/) | 2.4.7 | 1 | - | 1 / 0 / 0 | 1 / 0 / 0 |
| [Link is descriptive](https://www.w3.org/WAI/standards-guidelines/act/rules/aizyf1/) | 2.4.9 | 5 | - | - | 3 / 0 / 0 |
| [Links with identical accessible names have equivalent purpose](https://www.w3.org/WAI/standards-guidelines/act/rules/b20e66/) | 2.4.9 | 6 | 0 / 0 / 0 | 0 / 6 / 0 | 2 / 4 / 2 |
| [Visible label is part of accessible name](https://www.w3.org/WAI/standards-guidelines/act/rules/2ee8b8/) | 2.5.3 | 16 | 16 / 0 / 0 | 16 / 0 / 1 | 16 / 0 / 1 |
| [Device motion based changes to the content can also be created from the user interface](https://www.w3.org/WAI/standards-guidelines/act/rules/7677a9/) | 2.5.4 | 1 | - | 0 / 1 / 0 | 0 / 1 / 0 |
| [Device motion based changes to the content can be disabled](https://www.w3.org/WAI/standards-guidelines/act/rules/c249d5/) | 2.5.4 | 1 | - | 0 / 1 / 0 | 0 / 1 / 0 |
| [HTML page has lang attribute](https://www.w3.org/WAI/standards-guidelines/act/rules/b5c3f8/) | 3.1.1 | 4 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| [HTML page `lang` attribute has valid language tag](https://www.w3.org/WAI/standards-guidelines/act/rules/bf051a/) | 3.1.1 | 4 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| [HTML page language subtag matches default language](https://www.w3.org/WAI/standards-guidelines/act/rules/ucwvc8/) | 3.1.1 | 5 | - | - | 4 / 0 / 0 |
| [Element with lang attribute has valid language tag](https://www.w3.org/WAI/standards-guidelines/act/rules/de46e4/) | 3.1.2 | 9 | 9 / 0 / 0 | 9 / 0 / 0 | 9 / 0 / 0 |
| [HTML element language subtag matches language](https://www.w3.org/WAI/standards-guidelines/act/rules/off6ek/) | 3.1.2 | 4 | - | - | 3 / 0 / 0 |
| [Error message describes invalid form field value](https://www.w3.org/WAI/standards-guidelines/act/rules/36b590/) | 3.3.1 | 5 | - | - | 3 / 0 / 0 |
| [Summary element has non-empty accessible name](https://www.w3.org/WAI/standards-guidelines/act/rules/2t702h/) | 4.1.2 | 3 | - | - | - |
| [Element with presentational children has no focusable content](https://www.w3.org/WAI/standards-guidelines/act/rules/307n5z/) | 4.1.2 | 5 | 5 / 0 / 0 | 5 / 0 / 0 | 5 / 0 / 0 |
| [Iframe elements with identical accessible names have equivalent purpose](https://www.w3.org/WAI/standards-guidelines/act/rules/4b1c6c/) | 4.1.2 | 4 | 0 / 1 / 0 | 0 / 1 / 0 | 0 / 1 / 0 |
| [Element with aria-hidden has no content in sequential focus navigation](https://www.w3.org/WAI/standards-guidelines/act/rules/6cfa84/) | 4.1.2 | 6 | 5 / 1 / 0 | 5 / 1 / 0 | 5 / 1 / 0 |
| [Button has non-empty accessible name](https://www.w3.org/WAI/standards-guidelines/act/rules/97a4e1/) | 4.1.2 | 5 | 5 / 0 / 0 | 5 / 0 / 0 | 5 / 0 / 0 |
| [Iframe element has non-empty accessible name](https://www.w3.org/WAI/standards-guidelines/act/rules/cae760/) | 4.1.2 | 4 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| [Form field has non-empty accessible name](https://www.w3.org/WAI/standards-guidelines/act/rules/e086e5/) | 4.1.2 | 9 | 9 / 0 / 0 | 9 / 0 / 0 | 9 / 0 / 0 |
| [Menuitem has non-empty accessible name](https://www.w3.org/WAI/standards-guidelines/act/rules/m6b1q3/) | 4.1.2 | 2 | 2 / 0 / 0 | 2 / 0 / 0 | 2 / 0 / 0 |
