import { Button, CodeBlock, Container, CopyButton, Footer, Link, MotionProvider, Navbar, Table, Tabs, ThemeProvider, animationClass, cx, effectClass, useTheme } from "@lily-ui/react";
import { Fragment } from "react";
import { CONTENT, LINKS, type Content, type Locale } from "./content";
import { Rings } from "./Rings";

function ThemeToggle({ labels }: { labels: Content["nav"]["theme"] }) {
  const { resolvedTheme, toggle } = useTheme();
  const dark = resolvedTheme === "dark";
  return (
    <Button variant="ghost" status="neutral" size="sm" className="theme-toggle" onClick={toggle} aria-label={dark ? labels.toLight : labels.toDark}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        {dark ? (
          <path fill="currentColor" d="M12 4a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1Zm0 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm7-6a1 1 0 1 1 0 2h-1a1 1 0 1 1 0-2h1ZM6 12a1 1 0 0 1-1 1H4a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1Zm6 5a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Z" />
        ) : (
          <path fill="currentColor" d="M20.4 14.2A8.5 8.5 0 0 1 9.8 3.6a.75.75 0 0 0-1-.9A9.5 9.5 0 1 0 21.3 15.2a.75.75 0 0 0-.9-1Z" />
        )}
      </svg>
    </Button>
  );
}

/** Keeps a term on one line, so that a hyphenated name is not broken at its hyphen. */
function keepTogether(text: string, term: string) {
  const [before, after] = text.split(term);
  if (after === undefined) return text;
  return (
    <>
      {before}
      <span className="nowrap">{term}</span>
      {after}
    </>
  );
}

function Page({ t }: { t: Content }) {
  const home = t.locale === "ja" ? "./" : "./";
  return (
    <>
      <a className="skip-link" href="#main">
        {t.nav.skip}
      </a>
      <header className="site-header">
        <Container width="xl">
          <Navbar
            label={t.nav.label}
            brandHref={home}
            brand={
              <span className="brand">
                <img className="brand__logo brand__logo--light" src={`${import.meta.env.BASE_URL}kikori-logo-light.svg`} alt="kikori" width="118" height="34" />
                <img className="brand__logo brand__logo--dark" src={`${import.meta.env.BASE_URL}kikori-logo-dark.svg`} alt="kikori" width="118" height="34" />
              </span>
            }
          >
            <a href="#compare">{t.nav.compare}</a>
            <a href="#how">{t.nav.how}</a>
            <a href="#checks">{t.nav.checks}</a>
            <a href="#start">{t.nav.start}</a>
            <a href={LINKS.repo}>{t.nav.github}</a>
            <a href={t.otherLocale.href} lang={t.otherLocale.lang} hrefLang={t.otherLocale.lang}>
              {t.otherLocale.label}
            </a>
            <ThemeToggle labels={t.nav.theme} />
          </Navbar>
        </Container>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <Container width="xl" className="hero__grid">
            <div className={cx("hero__copy", animationClass("fade-in-up"))}>
              <h1 id="hero-title">{keepTogether(t.hero.title, "axe-core")}</h1>
              <p className="hero__lead">{t.hero.lead}</p>
              <div className="install">
                <code className="install__code">
                  {t.hero.install.split(" ").map((word, index) => (
                    <Fragment key={index}>
                      {index > 0 ? " " : null}
                      <span>{word}</span>
                    </Fragment>
                  ))}
                </code>
                <CopyButton value={t.hero.install} copyLabel={t.hero.copy} copiedLabel={t.hero.copied} size="sm" className="install__copy" />
              </div>
              <p className="hero__more">
                <Link href={LINKS.readme(t.locale)}>{t.hero.docs}</Link>
              </p>
            </div>
            <figure className="hero__figure" id="compare">
              <Rings items={t.rings.items} summary={t.rings.summary} />
              <figcaption>
                <h2 className="rings-title">{t.rings.heading}</h2>
                <ul className="legend">
                  {t.rings.items.map((item) => (
                    <li key={item.key} className={`legend__item legend__item--${item.key}`}>
                      <span className="legend__swatch" aria-hidden="true" />
                      <span className="legend__label">{item.label}</span>
                      <span className="legend__value">
                        {item.value}%<span className="legend__count"> ({t.rings.count(item.count)})</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="rings-caption">{t.rings.caption}</p>
              </figcaption>
            </figure>
          </Container>
          <Container width="xl">
            <p className="rings-note">
              {t.rings.note} <Link href={LINKS.results}>{t.rings.noteLink}</Link>
            </p>
          </Container>
        </section>

        <section className="band" aria-labelledby="beyond-title">
          <Container width="xl">
            <h2 id="beyond-title">{t.beyond.heading}</h2>
            <p className="lead">{t.beyond.lead}</p>
            <ul className="grain">
              {t.beyond.items.map((item) => (
                <li key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </li>
              ))}
            </ul>
          </Container>
        </section>

        <section className="band band--bark" id="how" aria-labelledby="how-title">
          <Container width="xl">
            <h2 id="how-title">{t.how.heading}</h2>
            <p className="lead">{t.how.lead}</p>
            <ol className="steps">
              {t.how.steps.map((step) => (
                <li key={step.title}>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
            <p className="caution">{t.how.status}</p>
          </Container>
        </section>

        <section className="band" id="checks" aria-labelledby="checks-title">
          <Container width="xl">
            <h2 id="checks-title">{t.checks.heading}</h2>
            <p className="lead">{t.checks.lead}</p>
            <Table role="table" caption={<span className="visually-hidden">{t.checks.caption}</span>} className="tools">
              <thead role="rowgroup">
                <tr role="row">
                  {t.checks.columns.map((column) => (
                    <th key={column} scope="col" role="columnheader">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody role="rowgroup">
                {t.checks.rows.map(([tool, criteria, what]) => (
                  <tr key={tool} role="row">
                    <th scope="row" role="rowheader">
                      <code>{tool}</code>
                    </th>
                    <td role="cell">{criteria}</td>
                    <td role="cell">{what}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Container>
        </section>

        <section className="band band--sap" id="start" aria-labelledby="start-title">
          <Container width="xl" className="start">
            <div>
              <h2 id="start-title">{t.start.heading}</h2>
              <p className="lead">{t.start.lead}</p>
              <p>
                {t.start.options} <Link href={LINKS.options(t.locale)}>{t.start.optionsLink}</Link>
              </p>
            </div>
            <Tabs
              label={t.start.heading}
              defaultValue={t.start.tabs[0]!.id}
              items={t.start.tabs.map((tab) => ({
                id: tab.id,
                label: tab.label,
                content: (
                  <div className="start__panel">
                    <p>{tab.body}</p>
                    <CodeBlock code={tab.code} language={tab.language} copyable copyLabel={t.hero.copy} copiedLabel={t.hero.copied} />
                  </div>
                ),
              }))}
            />
          </Container>
        </section>

        <section className="band" aria-labelledby="mobile-title">
          <Container width="xl" className="mobile">
            <h2 id="mobile-title">{t.mobile.heading}</h2>
            <p>{t.mobile.body}</p>
            <p>
              <Link href={LINKS.mobile(t.locale)}>{t.mobile.link}</Link>
            </p>
          </Container>
        </section>
      </main>

      <Footer bordered className="site-footer">
        <Container width="xl" className="site-footer__inner">
          <p>
            {t.footer.license} {t.footer.disclaimer}
          </p>
          <ul>
            <li>
              <a className={effectClass("lift")} href={LINKS.repo}>
                {t.footer.github}
              </a>
            </li>
            <li>
              <a className={effectClass("lift")} href={LINKS.npm}>
                {t.footer.npm}
              </a>
            </li>
            <li>
              <a className={effectClass("lift")} href={LINKS.issues}>
                {t.footer.issues}
              </a>
            </li>
          </ul>
        </Container>
      </Footer>
    </>
  );
}

export function App({ locale }: { locale: Locale }) {
  return (
    <ThemeProvider defaultMode="system">
      <MotionProvider>
        <Page t={CONTENT[locale]} />
      </MotionProvider>
    </ThemeProvider>
  );
}
