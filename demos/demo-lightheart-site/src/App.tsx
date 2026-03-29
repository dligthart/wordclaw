import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useState,
  type FormEvent,
} from 'react'
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import {
  brandLogos,
  localeNames,
  siteData,
  type Locale,
  type SiteContent,
} from './site-data'

interface SiteContextValue {
  locale: Locale
  content: SiteContent
  setLocale: (locale: Locale) => void
}

const SiteContext = createContext<SiteContextValue | null>(null)

function useSite() {
  const context = useContext(SiteContext)
  if (!context) {
    throw new Error('Site context not available')
  }
  return context
}

function resolveTitle(pathname: string, content: SiteContent) {
  switch (pathname) {
    case '/services':
      return `${content.services.title} | Lightheart Demo`
    case '/approach':
      return `${content.approach.title} | Lightheart Demo`
    case '/case-studies':
      return `${content.caseStudies.title} | Lightheart Demo`
    case '/about':
      return `${content.about.title} | Lightheart Demo`
    case '/contact':
      return `${content.contact.title} | Lightheart Demo`
    case '/wordclaw-fit':
      return `${content.wordclawFit.title} | Lightheart Demo`
    default:
      return `${content.home.heroTitle} | Lightheart Demo`
  }
}

function ScrollManager() {
  const { pathname } = useLocation()
  const { content } = useSite()

  useEffect(() => {
    window.scrollTo(0, 0)
    document.title = resolveTitle(pathname, content)
  }, [content, pathname])

  return null
}

function SectionHeading(props: {
  eyebrow: string
  title: string
  description: string
  align?: 'left' | 'center'
}) {
  const alignClass = props.align === 'center' ? 'section-heading centered' : 'section-heading'
  return (
    <div className={alignClass}>
      <p className="eyebrow">{props.eyebrow}</p>
      <h2>{props.title}</h2>
      <p>{props.description}</p>
    </div>
  )
}

function PageIntro(props: { eyebrow: string; title: string; description: string }) {
  return (
    <section className="section shell page-intro">
      <p className="eyebrow">{props.eyebrow}</p>
      <h1>{props.title}</h1>
      <p>{props.description}</p>
    </section>
  )
}

function App() {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = window.localStorage.getItem('demo-lightheart-locale')
    return stored === 'nl' ? 'nl' : 'en'
  })

  useEffect(() => {
    window.localStorage.setItem('demo-lightheart-locale', locale)
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = (nextLocale: Locale) => {
    startTransition(() => {
      setLocaleState(nextLocale)
    })
  }

  return (
    <BrowserRouter>
      <SiteContext.Provider
        value={{
          locale,
          content: siteData[locale],
          setLocale,
        }}
      >
        <ScrollManager />
        <SiteFrame />
      </SiteContext.Provider>
    </BrowserRouter>
  )
}

function SiteFrame() {
  return (
    <div className="site-app">
      <Header />
      <main className="site-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/approach" element={<ApproachPage />} />
          <Route path="/case-studies" element={<CaseStudiesPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/wordclaw-fit" element={<WordClawFitPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}

function Header() {
  const { content, locale, setLocale } = useSite()
  const { pathname } = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [pathname])

  return (
    <header className="site-header">
      <div className="shell header-row">
        <Link className="brand-lockup" to="/">
          <img
            src="/lightheart-tech-logo.svg"
            alt={content.header.brandAlt}
            className="brand-mark"
          />
          <div>
            <span className="brand-wordmark">Lightheart Tech</span>
            <span className="brand-caption">WordClaw feasibility demo</span>
          </div>
        </Link>

        <nav className="nav-desktop" aria-label="Primary">
          {content.header.navigation.map((item) => (
            <NavLink key={item.path} to={item.path} className="nav-link">
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="header-actions">
          <Link className="fit-pill" to="/wordclaw-fit">
            {content.common.fitNavLabel}
          </Link>
          <div className="locale-switcher" aria-label={content.common.languageLabel}>
            {(Object.keys(localeNames) as Locale[]).map((key) => (
              <button
                key={key}
                type="button"
                className={key === locale ? 'locale-button active' : 'locale-button'}
                onClick={() => setLocale(key)}
              >
                {localeNames[key]}
              </button>
            ))}
          </div>
          <Link className="button button-primary desktop-contact" to="/contact">
            {content.header.ctaLabel}
          </Link>
          <button
            type="button"
            className="menu-toggle"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label="Toggle navigation"
            aria-expanded={mobileMenuOpen}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      {mobileMenuOpen ? (
        <div className="shell mobile-menu">
          <nav className="mobile-nav" aria-label="Mobile">
            {content.header.navigation.map((item) => (
              <NavLink key={item.path} to={item.path} className="mobile-nav-link">
                {item.label}
              </NavLink>
            ))}
            <Link className="button button-primary mobile-contact" to="/contact">
              {content.header.ctaLabel}
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  )
}

function Footer() {
  const { content } = useSite()
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer">
      <div className="shell footer-grid">
        <div className="footer-intro">
          <p className="eyebrow eyebrow-dark">{content.footer.eyebrow}</p>
          <h2>{content.footer.title}</h2>
          <p>{content.footer.description}</p>
          <Link className="button button-primary" to="/contact">
            {content.footer.contactCta}
          </Link>
        </div>

        <div className="footer-columns">
          {content.footer.columns.map((column) => (
            <div key={column.title} className="footer-column">
              <h3>{column.title}</h3>
              {column.links.map((link) => (
                <Link key={link.path} to={link.path}>
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="shell footer-meta">
        <p>{content.footer.legalNotice}</p>
        <p>{content.footer.copyright.replace('{year}', String(year))}</p>
      </div>
    </footer>
  )
}

function HomePage() {
  const { content } = useSite()

  return (
    <>
      <section className="section shell hero-section">
        <div className="hero-copy">
          <p className="eyebrow eyebrow-dark">{content.home.eyebrow}</p>
          <h1>{content.home.heroTitle}</h1>
          <p className="hero-description">{content.home.heroDescription}</p>
          <div className="hero-actions">
            <Link className="button button-primary" to="/contact">
              {content.home.heroPrimaryCta}
            </Link>
            <Link className="button button-ghost" to="/approach">
              {content.home.heroSecondaryCta}
            </Link>
          </div>
          <div className="hero-notes">
            <span>Localized copy</span>
            <span>Repeatable sections</span>
            <span>Asset references</span>
          </div>
        </div>

        <div className="hero-visual">
          <img
            src="/agentic-coding-hero.svg"
            alt="Lightheart hero illustration"
            className="hero-art"
          />
          <div className="hero-sidecard">
            <p className="hero-sidecard-label">WordClaw framing</p>
            <h2>{content.common.fitTeaserTitle}</h2>
            <p>{content.common.fitTeaserText}</p>
            <Link className="button button-secondary" to="/wordclaw-fit">
              {content.common.fitTeaserCta}
            </Link>
          </div>
        </div>
      </section>

      <section className="section shell">
        <SectionHeading
          eyebrow={content.home.serviceLabel}
          title={content.home.serviceTitle}
          description={content.home.serviceDescription}
        />
        <div className="card-grid card-grid-three">
          {content.home.services.map((service) => (
            <article key={service.title} className="surface-card">
              <h3>{service.title}</h3>
              <p>{service.summary}</p>
              <ul className="feature-list">
                {service.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
              <Link className="text-link" to={service.href}>
                {service.linkLabel}
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell">
        <SectionHeading
          eyebrow={content.home.snapshotLabel}
          title={content.home.snapshotTitle}
          description={content.home.snapshotDescription}
        />
        <div className="card-grid card-grid-three">
          {content.home.deliverySnapshots.map((snapshot) => (
            <article key={snapshot.title} className="surface-card snapshot-card">
              <p className="small-label">{snapshot.label}</p>
              <h3>{snapshot.title}</h3>
              <p>{snapshot.detail}</p>
              <div className="snapshot-outcome">{snapshot.outcome}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell split-grid">
        <div className="surface-card feature-panel">
          <SectionHeading
            eyebrow={content.home.qualityLabel}
            title={content.home.qualityTitle}
            description={content.home.qualityDescription}
          />
          <ul className="feature-list large">
            {content.home.qualityPillars.map((pillar) => (
              <li key={pillar}>{pillar}</li>
            ))}
          </ul>
          <Link className="button button-secondary" to="/approach">
            {content.home.heroSecondaryCta}
          </Link>
        </div>

        <div className="surface-card fit-panel">
          <p className="eyebrow">{content.common.fitNavLabel}</p>
          <h2>{content.common.fitTeaserTitle}</h2>
          <p>{content.common.fitTeaserText}</p>
          <div className="fit-points">
            <span>Structured pages</span>
            <span>Localized fields</span>
            <span>Media assets</span>
            <span>Editorial approvals</span>
          </div>
          <Link className="button button-primary" to="/wordclaw-fit">
            {content.common.fitTeaserCta}
          </Link>
        </div>
      </section>

      <section className="section shell">
        <SectionHeading
          eyebrow={content.home.sectorsLabel}
          title={content.home.sectorsTitle}
          description={content.home.sectorsDescription}
        />
        <div className="card-grid card-grid-three">
          {content.home.sectors.map((sector) => (
            <article key={sector.title} className="sector-card">
              <img src={sector.image} alt={sector.alt} />
              <div className="sector-card-body">
                <h3>{sector.title}</h3>
                <p>{sector.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell">
        <SectionHeading
          eyebrow={content.home.brandsLabel}
          title={content.home.brandsTitle}
          description={content.home.brandsDescription}
          align="center"
        />
        <div className="logo-wall">
          {brandLogos.map((brand) => (
            <div key={brand.name} className="logo-card">
              <img src={brand.src} alt={brand.name} />
            </div>
          ))}
        </div>
      </section>

      <section className="section shell">
        <SectionHeading
          eyebrow={content.home.faqLabel}
          title={content.home.faqTitle}
          description={content.home.faqDescription}
        />
        <div className="faq-grid">
          {content.home.faq.map((item) => (
            <details key={item.question} className="faq-card">
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="section shell cta-banner">
        <div>
          <p className="eyebrow eyebrow-dark">{content.common.contactCta}</p>
          <h2>{content.home.contactTitle}</h2>
          <p>{content.home.contactDescription}</p>
        </div>
        <div className="cta-banner-actions">
          <Link className="button button-primary" to="/contact">
            {content.home.heroPrimaryCta}
          </Link>
          <Link className="button button-ghost" to="/wordclaw-fit">
            {content.common.fitTeaserCta}
          </Link>
        </div>
      </section>
    </>
  )
}

function ServicesPage() {
  const { content } = useSite()

  return (
    <>
      <PageIntro
        eyebrow={content.services.eyebrow}
        title={content.services.title}
        description={content.services.description}
      />

      <section className="section shell">
        <div className="card-grid card-grid-three">
          {content.services.serviceBlocks.map((block) => (
            <article key={block.title} className="surface-card">
              <h2>{block.title}</h2>
              <p>{block.detail}</p>
              <ul className="feature-list">
                {block.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <Link className="text-link" to={block.href}>
                {block.linkLabel}
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell">
        <div className="surface-card broad-panel">
          <h2>{content.services.chooseTitle}</h2>
          <div className="card-grid card-grid-three compact-top">
            {content.services.chooseGuides.map((guide) => (
              <article key={guide.title} className="mini-card">
                <h3>{guide.title}</h3>
                <p>{guide.text}</p>
              </article>
            ))}
          </div>
          <p className="supporting-copy">{content.services.chooseNote}</p>
        </div>
      </section>

      <section className="section shell cta-inline">
        <Link className="button button-primary" to="/contact">
          {content.services.ctaPrimary}
        </Link>
        <Link className="button button-secondary" to="/wordclaw-fit">
          {content.services.ctaSecondary}
        </Link>
      </section>
    </>
  )
}

function ApproachPage() {
  const { content } = useSite()

  return (
    <>
      <PageIntro
        eyebrow={content.approach.eyebrow}
        title={content.approach.title}
        description={content.approach.description}
      />

      <section className="section shell">
        <div className="card-grid card-grid-two">
          {content.approach.phases.map((phase) => (
            <article key={phase.title} className="surface-card">
              <h2>{phase.title}</h2>
              <p>{phase.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell">
        <SectionHeading
          eyebrow={content.approach.eyebrow}
          title={content.approach.methodsTitle}
          description={content.approach.methodsDescription}
        />
        <div className="card-grid card-grid-three">
          {content.approach.methods.map((item) => (
            <article key={item.title} className="surface-card">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell">
        <SectionHeading
          eyebrow={content.approach.eyebrow}
          title={content.approach.cadenceTitle}
          description={content.approach.cadenceDescription}
        />
        <div className="card-grid card-grid-two">
          {content.approach.cadenceItems.map((item) => (
            <article key={item.title} className="surface-card">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell split-grid">
        <article className="surface-card">
          <h2>{content.approach.controlsTitle}</h2>
          <ul className="feature-list large">
            {content.approach.controls.map((control) => (
              <li key={control}>{control}</li>
            ))}
          </ul>
        </article>

        <article className="surface-card">
          <h2>{content.approach.clientRequirementsTitle}</h2>
          <p>{content.approach.clientRequirementsDescription}</p>
          <ul className="feature-list large">
            {content.approach.clientRequirements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="section shell split-grid">
        <article className="surface-card">
          <h2>{content.approach.visibilityTitle}</h2>
          <p>{content.approach.visibilityDescription}</p>
          <div className="stack-list">
            {content.approach.visibilityItems.map((item) => (
              <div key={item.title} className="stack-item">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="surface-card">
          <h2>{content.approach.endStatesTitle}</h2>
          <p>{content.approach.endStatesDescription}</p>
          <div className="stack-list">
            {content.approach.endStates.map((item) => (
              <div key={item.title} className="stack-item">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <ul className="feature-list">
                  {item.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="section shell cta-inline">
        <Link className="button button-primary" to="/contact">
          {content.approach.ctaPrimary}
        </Link>
        <Link className="button button-secondary" to="/wordclaw-fit">
          {content.approach.ctaSecondary}
        </Link>
      </section>
    </>
  )
}

function CaseStudiesPage() {
  const { content } = useSite()

  return (
    <>
      <PageIntro
        eyebrow={content.caseStudies.eyebrow}
        title={content.caseStudies.title}
        description={content.caseStudies.description}
      />

      <section className="section shell">
        <div className="proof-strip">
          <h2>{content.caseStudies.proofPointsTitle}</h2>
          <div className="proof-pills">
            {content.caseStudies.proofPoints.map((point) => (
              <span key={point} className="proof-pill">
                {point}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="section shell case-study-list">
        {content.caseStudies.items.map((item, index) => (
          <article key={item.title} className="case-study-card">
            <div className={index % 2 === 0 ? 'case-study-head tone-a' : 'case-study-head tone-b'}>
              <p className="small-label">{item.outcomeType}</p>
              <h2>{item.title}</h2>
              <p>{item.context}</p>
            </div>

            <div className="case-study-meta-grid">
              <div>
                <span>{content.caseStudies.roleLabel}</span>
                <strong>{item.role}</strong>
              </div>
              <div>
                <span>{content.caseStudies.scopeLabel}</span>
                <strong>{item.scope}</strong>
              </div>
              <div>
                <span>{content.caseStudies.environmentLabel}</span>
                <strong>{item.environment}</strong>
              </div>
              <div>
                <span>{content.caseStudies.outcomeTypeLabel}</span>
                <strong>{item.outcomeType}</strong>
              </div>
            </div>

            <div className="case-study-body-grid">
              <div className="case-study-block">
                <h3>{content.caseStudies.challengeTitle}</h3>
                <p>{item.challenge}</p>
              </div>
              <div className="case-study-block">
                <h3>{content.caseStudies.ownershipTitle}</h3>
                <p>{item.ownership}</p>
              </div>
              <div className="case-study-block">
                <h3>{content.caseStudies.deliveredTitle}</h3>
                <p>{item.delivered}</p>
              </div>
              <div className="case-study-block">
                <h3>{content.caseStudies.outcomeTitle}</h3>
                <p>{item.outcome}</p>
              </div>
            </div>

            <div className="case-study-capability">
              <span>{content.caseStudies.capabilityTitle}</span>
              <p>{item.capability}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="section shell cta-inline">
        <Link className="button button-primary" to="/contact">
          {content.caseStudies.ctaPrimary}
        </Link>
        <Link className="button button-secondary" to="/wordclaw-fit">
          {content.common.fitTeaserCta}
        </Link>
      </section>
    </>
  )
}

function AboutPage() {
  const { content } = useSite()

  return (
    <>
      <PageIntro
        eyebrow={content.about.eyebrow}
        title={content.about.title}
        description={content.about.description}
      />

      <section className="section shell">
        <div className="card-grid card-grid-three">
          {content.about.principles.map((item) => (
            <article key={item.title} className="surface-card">
              <h2>{item.title}</h2>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell">
        <div className="surface-card broad-panel">
          <h2>{content.about.expectationTitle}</h2>
          <div className="card-grid card-grid-two compact-top">
            {content.about.expectations.map((item) => (
              <article key={item.title} className="mini-card">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section shell split-grid">
        <article className="surface-card">
          <p className="eyebrow">{content.about.leadTeam.label}</p>
          <h2>{content.about.leadTeam.title}</h2>
          <p>{content.about.leadTeam.description}</p>
          <h3>{content.about.leadTeam.rolesLabel}</h3>
          <div className="stack-list">
            {content.about.leadTeam.roles.map((role) => (
              <div key={role.title} className="stack-item">
                <h4>{role.title}</h4>
                <p>{role.text}</p>
              </div>
            ))}
          </div>
          <p className="supporting-copy">{content.about.leadTeam.note}</p>
        </article>

        <article className="surface-card">
          <h2>{content.about.fitGuidesTitle}</h2>
          <ul className="feature-list large">
            {content.about.leadTeam.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
          <div className="stack-list">
            {content.about.fitGuides.map((item) => (
              <div key={item.title} className="stack-item">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="section shell cta-inline">
        <Link className="button button-primary" to="/contact">
          {content.about.ctaPrimary}
        </Link>
        <Link className="button button-secondary" to="/wordclaw-fit">
          {content.about.ctaSecondary}
        </Link>
      </section>
    </>
  )
}

function ContactPage() {
  const { content } = useSite()
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'done'>('idle')
  const [requestType, setRequestType] = useState(content.contact.requestTypes[0] ?? '')

  useEffect(() => {
    setRequestType(content.contact.requestTypes[0] ?? '')
  }, [content.contact.requestTypes])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    setSubmitState('submitting')

    window.setTimeout(() => {
      form.reset()
      setRequestType(content.contact.requestTypes[0] ?? '')
      setSubmitState('done')
    }, 650)
  }

  return (
    <>
      <PageIntro
        eyebrow={content.contact.eyebrow}
        title={content.contact.title}
        description={content.contact.description}
      />

      <section className="section shell contact-grid">
        <article className="surface-card">
          <h2>{content.contact.formTitle}</h2>
          <p>{content.contact.formDescription}</p>
          <p className="supporting-copy">{content.contact.formNote}</p>

          <form className="contact-form" onSubmit={handleSubmit}>
            <div className="form-row">
              <label>
                <span>{content.contact.fields.nameLabel}</span>
                <input
                  type="text"
                  name="name"
                  placeholder={content.contact.fields.namePlaceholder}
                  required
                />
              </label>
              <label>
                <span>{content.contact.fields.emailLabel}</span>
                <input
                  type="email"
                  name="email"
                  placeholder={content.contact.fields.emailPlaceholder}
                  required
                />
              </label>
            </div>

            <div className="form-row">
              <label>
                <span>{content.contact.fields.companyLabel}</span>
                <input
                  type="text"
                  name="company"
                  placeholder={content.contact.fields.companyPlaceholder}
                />
              </label>
              <label>
                <span>{content.contact.fields.requestTypeLabel}</span>
                <select
                  name="requestType"
                  value={requestType}
                  onChange={(event) => setRequestType(event.target.value)}
                >
                  {content.contact.requestTypes.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label>
              <span>{content.contact.fields.timelineLabel}</span>
              <input
                type="text"
                name="timeline"
                placeholder={content.contact.fields.timelinePlaceholder}
              />
            </label>

            <label>
              <span>{content.contact.fields.messageLabel}</span>
              <textarea
                name="message"
                rows={7}
                placeholder={content.contact.fields.messagePlaceholder}
                required
              />
            </label>

            <div className="form-actions">
              <button className="button button-primary" type="submit" disabled={submitState === 'submitting'}>
                {submitState === 'submitting' ? '...' : content.common.contactCta}
              </button>
              <p className="form-note">{content.common.demoFormNote}</p>
            </div>

            {submitState === 'done' ? (
              <p className="success-banner">{content.contact.successMessage}</p>
            ) : null}
          </form>
        </article>

        <aside className="contact-side">
          <article className="surface-card">
            <h2>{content.contact.nextStepsTitle}</h2>
            <div className="stack-list">
              {content.contact.nextSteps.map((step) => (
                <div key={step.title} className="stack-item">
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              ))}
            </div>
          </article>

          <article className="surface-card">
            <h2>{content.contact.checklistTitle}</h2>
            <ul className="feature-list large">
              {content.contact.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="direct-email">
              <h3>{content.contact.directEmailTitle}</h3>
              <p>
                {content.contact.directEmailText}
                <a href={`mailto:${content.common.contactEmailLabel}`}>
                  {content.common.contactEmailLabel}
                </a>
              </p>
            </div>
          </article>
        </aside>
      </section>
    </>
  )
}

function WordClawFitPage() {
  const { content } = useSite()

  return (
    <>
      <PageIntro
        eyebrow={content.wordclawFit.eyebrow}
        title={content.wordclawFit.title}
        description={content.wordclawFit.description}
      />

      <section className="section shell split-grid">
        <article className="surface-card">
          <h2>{content.wordclawFit.strongFitsTitle}</h2>
          <ul className="feature-list large">
            {content.wordclawFit.strongFits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="surface-card">
          <h2>{content.wordclawFit.gapsTitle}</h2>
          <div className="stack-list">
            {content.wordclawFit.gaps.map((gap) => (
              <div key={gap.title} className="stack-item">
                <h3>{gap.title}</h3>
                <p>{gap.text}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="section shell">
        <div className="surface-card broad-panel">
          <h2>{content.wordclawFit.contentModelTitle}</h2>
          <div className="card-grid card-grid-three compact-top">
            {content.wordclawFit.contentModels.map((model) => (
              <article key={model.name} className="mini-card model-card">
                <p className="small-label">{model.name}</p>
                <h3>{model.purpose}</h3>
                <p>{model.notes}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section shell verdict-panel">
        <p className="eyebrow eyebrow-dark">{content.wordclawFit.verdictTitle}</p>
        <h2>{content.wordclawFit.title}</h2>
        <p>{content.wordclawFit.verdict}</p>
        <div className="cta-inline">
          <Link className="button button-primary" to="/contact">
            {content.common.contactCta}
          </Link>
          <Link className="button button-ghost" to="/">
            {content.common.backHomeLabel}
          </Link>
        </div>
      </section>
    </>
  )
}

function NotFoundPage() {
  const { content } = useSite()

  return (
    <section className="section shell not-found">
      <p className="eyebrow">{content.common.fitNavLabel}</p>
      <h1>404</h1>
      <p>The route does not exist in this demo.</p>
      <Link className="button button-primary" to="/">
        {content.common.backHomeLabel}
      </Link>
    </section>
  )
}

export default App
