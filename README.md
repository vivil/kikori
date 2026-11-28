# kikori website

The source of the [kikori](https://github.com/vivil/kikori) website, published at <https://vivil.github.io/kikori/>.

This branch holds only the website. The kikori packages live on the `main` branch.

## How it is built

- React and [@lily-ui/react](https://www.npmjs.com/package/@lily-ui/react), bundled with Vite.
- One page in English (`index.html`) and one in Japanese (`ja/index.html`). The text of both is in `src/content.ts`.
- The pages are rendered to HTML at build time, so they can be read without JavaScript.
- LINE Seed JP is served as two subsets that hold only the characters the site uses. `scripts/subset-fonts.mjs` builds them, and `npm run build` runs it first.

## Develop

```sh
npm ci
npm run dev       # local server with live reload
npm run build     # fonts, type check, bundle and prerender into dist/
npm run preview   # serve dist/ at http://localhost:4173/kikori/
```

The images shown when a link to the site is shared (`public/og-en.png`, `public/og-ja.png`) are drawn by `scripts/og-image.mjs`. It needs Playwright, which is not a dependency of the site. Run it again when the headline, the logo or the benchmark numbers change.

After changing any text, run `npm run build` (or `npm run fonts`) so that the font subsets include the new characters, and commit the files in `src/fonts/`.

## Publish

Pushing to this branch runs `.github/workflows/pages.yml`, which builds the site and deploys it to GitHub Pages. In the repository settings, Pages uses "GitHub Actions" as its source, and the `github-pages` environment allows deployments from the `docs` branch.

## Accessibility

The site is audited with kikori itself. Start `npm run preview` and audit `http://localhost:4173/kikori/` and `http://localhost:4173/kikori/ja/`.

## Licenses

- The site is MIT licensed, like kikori.
- LINE Seed JP is licensed under the SIL Open Font License 1.1. The license text is published with the site at `licenses/LINE-Seed-JP-OFL.txt`.
