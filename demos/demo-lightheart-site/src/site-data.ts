export type Locale = 'en' | 'nl'

export interface LinkItem {
  path: string
  label: string
}

export interface FooterColumn {
  title: string
  links: LinkItem[]
}

export interface SectionCard {
  title: string
  text: string
}

export interface SnapshotCard {
  label: string
  title: string
  detail: string
  outcome: string
}

export interface ServiceCard {
  title: string
  summary: string
  bullets: string[]
  href: string
  linkLabel: string
}

export interface SectorCard {
  title: string
  detail: string
  image: string
  alt: string
}

export interface FaqItem {
  question: string
  answer: string
}

export interface CaseStudy {
  title: string
  context: string
  scope: string
  role: string
  environment: string
  outcomeType: string
  challenge: string
  ownership: string
  delivered: string
  outcome: string
  capability: string
}

export interface FitGap {
  title: string
  text: string
}

export interface ContentModelCard {
  name: string
  purpose: string
  notes: string
}

export interface SiteContent {
  common: {
    languageLabel: string
    contactEmailLabel: string
    fitNavLabel: string
    fitTeaserTitle: string
    fitTeaserText: string
    fitTeaserCta: string
    demoFormNote: string
    backHomeLabel: string
    homeLabel: string
    contactCta: string
  }
  header: {
    brandAlt: string
    ctaLabel: string
    navigation: LinkItem[]
  }
  footer: {
    eyebrow: string
    title: string
    description: string
    columns: FooterColumn[]
    contactCta: string
    copyright: string
    legalNotice: string
  }
  home: {
    eyebrow: string
    heroTitle: string
    heroDescription: string
    heroPrimaryCta: string
    heroSecondaryCta: string
    serviceLabel: string
    serviceTitle: string
    serviceDescription: string
    services: ServiceCard[]
    snapshotLabel: string
    snapshotTitle: string
    snapshotDescription: string
    deliverySnapshots: SnapshotCard[]
    qualityLabel: string
    qualityTitle: string
    qualityDescription: string
    qualityPillars: string[]
    sectorsLabel: string
    sectorsTitle: string
    sectorsDescription: string
    sectors: SectorCard[]
    brandsLabel: string
    brandsTitle: string
    brandsDescription: string
    faqLabel: string
    faqTitle: string
    faqDescription: string
    faq: FaqItem[]
    contactTitle: string
    contactDescription: string
  }
  services: {
    eyebrow: string
    title: string
    description: string
    serviceBlocks: {
      title: string
      detail: string
      points: string[]
      href: string
      linkLabel: string
    }[]
    chooseTitle: string
    chooseGuides: SectionCard[]
    chooseNote: string
    ctaPrimary: string
    ctaSecondary: string
  }
  approach: {
    eyebrow: string
    title: string
    description: string
    phases: SectionCard[]
    methodsTitle: string
    methodsDescription: string
    methods: SectionCard[]
    cadenceTitle: string
    cadenceDescription: string
    cadenceItems: SectionCard[]
    controlsTitle: string
    controls: string[]
    visibilityTitle: string
    visibilityDescription: string
    visibilityItems: SectionCard[]
    clientRequirementsTitle: string
    clientRequirementsDescription: string
    clientRequirements: string[]
    endStatesTitle: string
    endStatesDescription: string
    endStates: {
      title: string
      text: string
      points: string[]
    }[]
    ctaPrimary: string
    ctaSecondary: string
  }
  caseStudies: {
    eyebrow: string
    title: string
    description: string
    proofPointsTitle: string
    proofPoints: string[]
    scopeLabel: string
    roleLabel: string
    environmentLabel: string
    outcomeTypeLabel: string
    challengeTitle: string
    ownershipTitle: string
    deliveredTitle: string
    outcomeTitle: string
    capabilityTitle: string
    items: CaseStudy[]
    ctaPrimary: string
  }
  about: {
    eyebrow: string
    title: string
    description: string
    principles: SectionCard[]
    expectationTitle: string
    expectations: SectionCard[]
    leadTeam: {
      label: string
      title: string
      description: string
      rolesLabel: string
      note: string
      roles: SectionCard[]
      bullets: string[]
    }
    fitGuidesTitle: string
    fitGuides: SectionCard[]
    ctaPrimary: string
    ctaSecondary: string
  }
  contact: {
    eyebrow: string
    title: string
    description: string
    formTitle: string
    formDescription: string
    formNote: string
    requestTypes: string[]
    fields: {
      nameLabel: string
      namePlaceholder: string
      emailLabel: string
      emailPlaceholder: string
      companyLabel: string
      companyPlaceholder: string
      requestTypeLabel: string
      timelineLabel: string
      timelinePlaceholder: string
      messageLabel: string
      messagePlaceholder: string
    }
    successMessage: string
    nextStepsTitle: string
    nextSteps: SectionCard[]
    checklistTitle: string
    checklist: string[]
    directEmailTitle: string
    directEmailText: string
  }
  wordclawFit: {
    eyebrow: string
    title: string
    description: string
    strongFitsTitle: string
    strongFits: string[]
    gapsTitle: string
    gaps: FitGap[]
    contentModelTitle: string
    contentModels: ContentModelCard[]
    verdictTitle: string
    verdict: string
  }
}

export const brandLogos = [
  { name: 'Klarna', src: '/logos/klarna-wordmark.svg' },
  { name: 'Shopify', src: '/logos/shopify-wordmark.svg' },
  { name: 'bol.com', src: '/logos/bolcom-wordmark.png' },
  { name: 'Staples', src: '/logos/staples-wordmark.png' },
  { name: 'Eyecons', src: '/logos/eyecons-wordmark.png' },
  { name: 'Schiphol', src: '/logos/schiphol-wordmark.png' },
] as const

export const localeNames: Record<Locale, string> = {
  en: 'EN',
  nl: 'NL',
}

export const siteData: Record<Locale, SiteContent> = {
  en: {
    common: {
      languageLabel: 'Language',
      contactEmailLabel: 'hello@lightheart.tech',
      fitNavLabel: 'WordClaw fit',
      fitTeaserTitle: 'Can WordClaw run a site like this?',
      fitTeaserText:
        'This demo models the Lightheart site as structured pages, localized copy, repeatable section blocks, and referenced assets, then makes the current gaps explicit.',
      fitTeaserCta: 'Review the fit and gaps',
      demoFormNote:
        'Demo note: this form only simulates submission. In a real WordClaw setup, contact delivery would be handled by a custom API route or workflow.',
      backHomeLabel: 'Back to home',
      homeLabel: 'Home',
      contactCta: 'Get in Touch',
    },
    header: {
      brandAlt: 'Lightheart Tech logo',
      ctaLabel: 'Get in Touch',
      navigation: [
        { path: '/services', label: 'Services' },
        { path: '/approach', label: 'Approach' },
        { path: '/case-studies', label: 'Case Studies' },
        { path: '/about', label: 'About' },
      ],
    },
    footer: {
      eyebrow: 'Lightheart Tech',
      title: 'Senior-led product and platform delivery.',
      description:
        'Lightheart helps product teams and strategic software programs ship defined workstreams faster with senior oversight, release discipline, and transfer-ready handover.',
      columns: [
        {
          title: 'Company',
          links: [
            { path: '/', label: 'Home' },
            { path: '/services', label: 'Services' },
            { path: '/approach', label: 'Approach' },
            { path: '/about', label: 'About' },
          ],
        },
        {
          title: 'Delivery',
          links: [
            { path: '/case-studies', label: 'Case Studies' },
            { path: '/contact', label: 'Contact' },
            { path: '/wordclaw-fit', label: 'WordClaw fit' },
          ],
        },
      ],
      contactCta: 'Request capability overview',
      copyright: 'Copyright {year} Lightheart Tech. All rights reserved.',
      legalNotice:
        'This demo is based on the local lightheart.tech source and adapted to test how far WordClaw can carry a site with the same content patterns.',
    },
    home: {
      eyebrow: 'Lightheart Tech',
      heroTitle: 'Ship faster without cutting corners on quality.',
      heroDescription:
        'Lightheart delivers product, platform, and AI projects with senior engineers who own architecture, quality, and release. You get speed and a clean handover, not a mess to untangle later.',
      heroPrimaryCta: 'Get in Touch',
      heroSecondaryCta: 'See how we work',
      serviceLabel: 'Services',
      serviceTitle: 'Three ways to work with us.',
      serviceDescription:
        'Pick the model that fits your situation: a focused sprint, a structured product build phase, or embedded support inside a larger program.',
      services: [
        {
          title: 'AI Delivery Sprint',
          summary:
            'A focused 2-week sprint to ship one high-priority feature or release, with senior engineers reviewing every step.',
          bullets: [
            'AI-assisted developer team',
            'Weekly progress updates you can act on',
            'Release checklist and handover included',
          ],
          href: '/services',
          linkLabel: 'View sprint details',
        },
        {
          title: 'Product Build Phase',
          summary:
            'Take validated scope to a production-ready release with clear milestones, real check-ins, and a handover your team can use immediately.',
          bullets: [
            'Production-ready product increment',
            'Database and API integrations',
            'Launch prep, stabilization, and handover',
          ],
          href: '/services',
          linkLabel: 'View build phase',
        },
        {
          title: 'Strategic Workstream Delivery',
          summary:
            'A senior team that embeds into your program to own a defined platform, integration, data, or AI-enabled workstream within your governance and architecture.',
          bullets: [
            'Clearly scoped workstream ownership',
            'Architecture, security, and release alignment',
            'Documentation and transition context for internal teams',
          ],
          href: '/case-studies',
          linkLabel: 'See enterprise fit',
        },
      ],
      snapshotLabel: 'Delivery snapshot',
      snapshotTitle: 'What the engagement looks like in practice',
      snapshotDescription:
        'The Lightheart site sells a senior-led delivery model. These cards are the kind of repeatable narrative blocks WordClaw can store cleanly.',
      deliverySnapshots: [
        {
          label: 'Before build',
          title: 'We agree on exactly what gets shipped',
          detail:
            'Together we define the target outcome, set clear acceptance criteria, and identify anything that could slow us down.',
          outcome: 'You know what is in scope, what is not, and what the risks are.',
        },
        {
          label: 'During delivery',
          title: 'You see real progress every week',
          detail:
            'Weekly updates show what shipped, what is at risk, and what decisions are needed from your side.',
          outcome: 'No surprises. No vague status reports.',
        },
        {
          label: 'At handover',
          title: 'Your team can take over immediately',
          detail:
            'Documentation, release notes, and context are delivered so your team can maintain and extend the work confidently.',
          outcome: 'No reverse-engineering. No knowledge gaps.',
        },
      ],
      qualityLabel: 'Quality model',
      qualityTitle: 'Fast does not mean sloppy',
      qualityDescription:
        'AI makes teams faster, but the operating model determines whether that speed holds up in production. This demo keeps the Lightheart message intact while mapping it to structured content.',
      qualityPillars: [
        'Every pull request reviewed by a senior engineer',
        'AI-generated code passes the same quality bar as handwritten code',
        'Security and reliability tests run automatically on every change',
        'Documentation written for your team, not ours',
      ],
      sectorsLabel: 'Best fit',
      sectorsTitle: 'Who this model is built for',
      sectorsDescription:
        'The original site leans on a mix of reusable copy blocks and marketing imagery. WordClaw can manage the content and assets; the front-end still owns the presentation layer.',
      sectors: [
        {
          title: 'Product releases',
          detail: 'When roadmap pressure is high and the next milestone cannot slip.',
          image: '/img/best-fit-product-releases.png',
          alt: 'Product and engineering team reviewing roadmap charts during a planning session',
        },
        {
          title: 'Platform foundations',
          detail: 'When architecture, integrations, and delivery discipline matter as much as feature velocity.',
          image: '/img/best-fit-platform-foundations.png',
          alt: 'Senior architect working on cloud infrastructure topology at a standing desk',
        },
        {
          title: 'Strategic workstreams',
          detail: 'When a broader software program needs senior-led contribution to a clearly defined scope.',
          image: '/img/best-fit-strategic-workstreams.png',
          alt: 'Senior leadership team reviewing delivery metrics and project scope',
        },
      ],
      brandsLabel: 'Selected support',
      brandsTitle: 'Teams Lightheart has supported',
      brandsDescription:
        'Selected brands from projects where Lightheart supported delivery, engineering, and platform execution.',
      faqLabel: 'FAQ',
      faqTitle: 'Questions teams ask before starting',
      faqDescription:
        'FAQ entries are another clean fit for WordClaw: repeatable, structured, localizable content blocks.',
      faq: [
        {
          question: 'Do you replace our internal team?',
          answer:
            'No. Lightheart works alongside your team on a defined scope, such as a sprint, a product build phase, or a specific release.',
        },
        {
          question: 'Can you work inside our existing processes?',
          answer:
            'Yes. Lightheart plugs into your architecture, release process, and governance rather than forcing a new operating model.',
        },
        {
          question: 'What if procurement needs documentation?',
          answer:
            'Capability overviews, security summaries, and a legal baseline can be supplied to support vendor review.',
        },
        {
          question: 'What do we get when the project is done?',
          answer:
            'Working software, documentation, and a structured handover so your team can own and extend the work.',
        },
      ],
      contactTitle: 'Not sure which model fits? Let us help.',
      contactDescription:
        'Tell us what you are trying to ship, your timeline, and what is making it hard. We will tell you if we can help and which engagement model makes sense.',
    },
    services: {
      eyebrow: 'Services',
      title: 'Delivery models built for real software constraints.',
      description:
        'Some clients need a contained sprint. Others need a defined product phase or a specialist workstream inside a wider program. Lightheart is designed for both, provided the outcome, ownership, and boundaries are clear.',
      serviceBlocks: [
        {
          title: 'AI Delivery Sprint',
          detail:
            'A focused 2-week sprint for teams that need one high-priority release or implementation burst moved quickly with senior oversight.',
          points: [
            'AI-assisted developer team',
            'Decision-ready weekly progress updates',
            'Release checklist and handover included',
          ],
          href: '/contact',
          linkLabel: 'Discuss a sprint',
        },
        {
          title: 'Product Build Phase',
          detail:
            'A structured build phase for teams that need validated scope turned into a production-ready release with clear checkpoints, stabilization, and handover.',
          points: [
            'Production-ready product increment',
            'Database and API integrations',
            'Authentication, onboarding, and core flows',
            'Launch stabilization and handover',
          ],
          href: '/contact',
          linkLabel: 'Discuss a build phase',
        },
        {
          title: 'Strategic Workstream Delivery',
          detail:
            'A specialist engagement model for broader platform, integration, data, and AI-enabled programs that need a compact senior team to own a defined workstream inside existing client governance.',
          points: [
            'Scoped workstream plan',
            'Implementation ownership and architecture alignment',
            'Cross-team dependency visibility',
            'Release readiness and transition documentation',
          ],
          href: '/contact',
          linkLabel: 'Discuss a workstream',
        },
      ],
      chooseTitle: 'How to choose the right model',
      chooseGuides: [
        {
          title: 'Choose AI Delivery Sprint if...',
          text: 'You already have a live product or platform and need faster delivery on one constrained priority.',
        },
        {
          title: 'Choose Product Build Phase if...',
          text: 'You need to move from validated scope to a first production boundary with explicit checkpoints, stabilization, and handover.',
        },
        {
          title: 'Choose Strategic Workstream Delivery if...',
          text: 'You need senior-led contribution inside a broader platform, integration, data, or AI-enabled program while respecting governance and release controls.',
        },
      ],
      chooseNote:
        'If the fit is unclear, the right answer is to say no-fit early instead of forcing the work into a package.',
      ctaPrimary: 'Request capability overview',
      ctaSecondary: 'Review WordClaw fit',
    },
    approach: {
      eyebrow: 'Approach',
      title: 'How Lightheart runs agile delivery inside real client constraints.',
      description:
        'The Lightheart site is mostly a sequence of structured sections with distinct visual treatments. This page keeps those section patterns while showing where WordClaw is strong and where custom site logic still matters.',
      phases: [
        {
          title: '1. Frame',
          text: 'Align on the business outcome, scope boundaries, acceptance criteria, constraints, and known risks before delivery starts.',
        },
        {
          title: '2. Plan',
          text: 'Translate the scoped outcome into a working backlog, sprint cadence, architecture approach, and release assumptions.',
        },
        {
          title: '3. Sprint execution',
          text: 'Deliver in short iterations with reviewable increments, senior technical oversight, and explicit tradeoff handling.',
        },
        {
          title: '4. Validate and release',
          text: 'Run test, security, architecture, environment, and release-readiness checks before a go/no-go decision is made.',
        },
        {
          title: '5. Transition or operate',
          text: 'Close with transfer-ready documentation and knowledge handover, or continue in a defined maintenance path.',
        },
      ],
      methodsTitle: 'Proven delivery disciplines behind the model',
      methodsDescription:
        'Each of these cards can be represented as repeatable structured blocks instead of one large rich-text page.',
      methods: [
        {
          title: 'Agile delivery',
          text: 'Scoped backlog, sprint planning, refinement, demos, and retrospectives keep progress visible and decision-making fast.',
        },
        {
          title: 'DevOps automation',
          text: 'CI/CD, infrastructure as code, repeatable environments, and release automation reduce manual delivery risk.',
        },
        {
          title: 'DevSecOps controls',
          text: 'Security checks, dependency review, secrets handling, and release gates are embedded in the workflow.',
        },
        {
          title: 'SRE and observability',
          text: 'Monitoring, runbooks, incident readiness, and reliability thinking help releases stay supportable after launch.',
        },
        {
          title: 'FinOps discipline',
          text: 'Cloud cost visibility and cost-performance tradeoffs are managed as part of delivery where relevant.',
        },
        {
          title: 'Architecture governance',
          text: 'Key technical decisions are documented and reviewed before they become release risk.',
        },
      ],
      cadenceTitle: 'How work runs week to week',
      cadenceDescription:
        'Another strong content-runtime fit: a page assembled from consistent, typed narrative sections.',
      cadenceItems: [
        {
          title: 'Backlog refinement and sprint planning',
          text: 'Keep scope current, break work into decision-ready increments, and confirm what is entering the next sprint.',
        },
        {
          title: 'Async updates and active risk management',
          text: 'Open risks, blockers, and decisions are surfaced continuously rather than hidden until the end of the week.',
        },
        {
          title: 'Reviewable progress every sprint',
          text: 'Demoable increments, technical review, and stakeholder feedback are built into the cadence.',
        },
        {
          title: 'Release go/no-go discipline',
          text: 'Release readiness is treated as an explicit decision with quality, security, operational, and ownership checks.',
        },
      ],
      controlsTitle: 'Operational controls that protect quality at speed',
      controls: [
        'Architecture decisions are reviewed and documented in a traceable decision log.',
        'AI-generated code passes the same review, test, and release bar as manually authored code.',
        'CI includes testing, security checks, and reliability or performance validation where relevant.',
        'Handover or ongoing support is agreed up front as an explicit delivery outcome.',
      ],
      visibilityTitle: 'What clients actually get visibility into',
      visibilityDescription:
        'The operating model is designed to keep clients involved in decisions without dragging them into daily execution.',
      visibilityItems: [
        {
          title: 'A scoped milestone',
          text: 'Kickoff aligns on the business result, technical boundaries, acceptance criteria, and what is intentionally out of scope.',
        },
        {
          title: 'Decision-ready reporting',
          text: 'Updates highlight shipped work, open risks, pending decisions, and the next approval or action required.',
        },
        {
          title: 'Artifacts your team can keep using',
          text: 'Backlog context, release notes, documentation, runbooks, and decision records are built so the work survives the engagement.',
        },
      ],
      clientRequirementsTitle: 'What the model needs from the client side',
      clientRequirementsDescription:
        'This is a good example of content that WordClaw can store but not enforce operationally on its own.',
      clientRequirements: [
        'A real decision owner who can make scope and priority decisions quickly.',
        'Access to the relevant codebase, backlog tools, environments, and delivery constraints.',
        'A shared definition of done, release process, security expectations, and documentation expectations.',
        'Availability for weekly reviews, unblock moments, and sprint or release decisions.',
      ],
      endStatesTitle: 'Choose the end state that fits the work',
      endStatesDescription:
        'The delivery story ends either in transfer or in ongoing support. Both are structured outcomes that WordClaw can represent clearly.',
      endStates: [
        {
          title: 'Transfer to your team',
          text: 'Best when your internal engineers will own the roadmap after release and need context they can act on immediately.',
          points: [
            'Handover documentation and release context',
            'Knowledge transfer sessions with your team',
            'Clear ownership transition and next-step recommendations',
          ],
        },
        {
          title: 'SLA-backed maintenance and support',
          text: 'Best when you need continuity after launch or a managed stabilization period.',
          points: [
            'Defined support scope, response expectations, and escalation path',
            'Bug fixing, maintenance, and controlled follow-on changes',
            'Operational continuity without losing release discipline',
          ],
        },
      ],
      ctaPrimary: 'Discuss your scope',
      ctaSecondary: 'Review the fit and gaps',
    },
    caseStudies: {
      eyebrow: 'Case Studies',
      title: 'Selected delivery examples with defined scope, visible ownership, and concrete outcomes.',
      description:
        'Case studies are one of the cleanest WordClaw fits in the whole site: structured records with repeatable metadata, long-form fields, and asset references.',
      proofPointsTitle: 'What these cases show',
      proofPoints: [
        'Product leadership under deadline pressure',
        'Platform rebuild and operational scalability',
        'Enterprise data pipeline reliability',
        'Infrastructure delivery in regulated, high-availability environments',
        'Defined workstream ownership inside real delivery constraints',
      ],
      scopeLabel: 'Scope',
      roleLabel: 'Role',
      environmentLabel: 'Environment',
      outcomeTypeLabel: 'Outcome type',
      challengeTitle: 'Challenge',
      ownershipTitle: 'What Lightheart owned',
      deliveredTitle: 'What was delivered',
      outcomeTitle: 'Outcome',
      capabilityTitle: 'Current Lightheart capability this reflects',
      items: [
        {
          title: 'Klarna x Shopify integration',
          context:
            'Commerce integration delivery for Klarna on Shopify, combining product direction, partner alignment, and launch execution.',
          scope: 'End-to-end product delivery from scoping through launch.',
          role: 'Product leadership and delivery execution.',
          environment: 'Partner-facing commerce integration in Shopify.',
          outcomeType: 'Launch-ready product delivery.',
          challenge:
            'Klarna needed to ship a Shopify integration that worked reliably across merchant setups, with tight coordination between product, engineering, and partner requirements.',
          ownership:
            'Lightheart led product scoping, implementation prioritization, and launch coordination, making sure engineering, QA, and partner dependencies stayed connected.',
          delivered:
            'A production-ready Shopify integration, built with clear scope boundaries, partner alignment, and structured handover documentation.',
          outcome:
            'The integration launched on schedule with clean merchant onboarding and no post-launch rework from scope ambiguity.',
          capability:
            'Product workstream ownership where scope, partner coordination, release timing, and handover all need to stay aligned.',
        },
        {
          title: 'Eyecons platform rebuild for scalability',
          context:
            'Full platform rebuild for an AI-powered live sports recording product that needed to scale across venues without operational fragility.',
          scope: 'Application architecture redesign, infrastructure rebuild, and Kubernetes platform.',
          role: 'AI Tech Lead and Cloud Architect.',
          environment: 'AI-powered live sports SaaS on Kubernetes.',
          outcomeType: 'Platform scalability and operational reliability.',
          challenge:
            'The existing application architecture and infrastructure could not support multi-venue scale. The full stack had to be rebuilt for reliability and growth.',
          ownership:
            'Lightheart rebuilt the full application architecture and infrastructure, redesigning the system on Kubernetes with a microservices approach.',
          delivered:
            'A re-architected platform on Kubernetes with a new application structure, new infrastructure, and a scalable foundation.',
          outcome:
            'Eyecons moved from a platform that could not scale to one built for multi-venue deployment and confident internal ownership.',
          capability:
            'Platform rebuilds, cloud architecture, and reliability-focused delivery for products that have outgrown the original stack.',
        },
        {
          title: 'Inter IKEA enterprise ETL pipeline',
          context:
            'High-volume data processing and validation work for enterprise supply chain operations where data quality failures could not leak downstream.',
          scope: 'Pipeline architecture, data validation design, and operational reliability.',
          role: 'Cloud Architect and technical design lead.',
          environment: 'Enterprise supply chain data environment.',
          outcomeType: 'Operational data reliability.',
          challenge:
            'Inter IKEA needed an ETL pipeline capable of processing high-volume supply chain data with strict validation requirements.',
          ownership:
            'Lightheart designed the ETL pipeline architecture, defined the validation approach, and made the infrastructure decisions that shaped long-term resilience.',
          delivered:
            'An ETL architecture handling high-volume data processing with built-in validation stages and clear operational ownership.',
          outcome:
            'The pipeline supported enterprise-scale processing reliably, with a validation framework that caught data quality issues before they reached downstream systems.',
          capability:
            'Defined data and integration workstreams where architecture, validation, and operational resilience matter as much as implementation speed.',
        },
        {
          title: 'Schiphol mapping and kiosk infrastructure',
          context:
            'Infrastructure and application delivery for Schiphol internal mapping and passenger-facing self-service kiosks under airport operational constraints.',
          scope:
            'Mapping platform architecture, kiosk application infrastructure, and integration with airport operational systems.',
          role: 'Cloud Architect and platform delivery lead.',
          environment: 'Airport operations infrastructure with high-availability requirements.',
          outcomeType: 'Operational platform delivery and passenger self-service capability.',
          challenge:
            'Schiphol needed a reliable internal mapping platform and self-service kiosk infrastructure operating within strict uptime and security requirements.',
          ownership:
            'Lightheart designed and delivered the mapping platform architecture and the kiosk infrastructure layer, including deployment pipelines and operational tooling.',
          delivered:
            'A production mapping platform plus a scalable kiosk infrastructure, integrated with existing operational and security systems.',
          outcome:
            'Schiphol gained a maintainable mapping capability and a self-service kiosk network that operates at airport scale.',
          capability:
            'Infrastructure-heavy platform delivery in regulated, high-availability environments where uptime, security, and enterprise integration are non-negotiable.',
        },
      ],
      ctaPrimary: 'Get in Touch',
    },
    about: {
      eyebrow: 'About',
      title: 'A compact senior team for delivery that needs both speed and experienced technical oversight.',
      description:
        'Many teams can generate code faster with AI. Fewer can integrate that speed into production delivery without creating quality debt, security concerns, or release instability.',
      principles: [
        {
          title: 'Practical AI adoption',
          text: 'AI is applied where it measurably improves delivery speed and consistency, not as a replacement for engineering judgment.',
        },
        {
          title: 'Compact by design',
          text: 'The operating model stays intentionally compact so accountability remains visible rather than diffused.',
        },
        {
          title: 'Senior accountability',
          text: 'Senior engineers remain accountable for architecture quality, codebase health, and release outcomes.',
        },
      ],
      expectationTitle: 'What clients can expect',
      expectations: [
        {
          title: 'Clear operating cadence',
          text: 'Explicit milestones, tradeoff decisions, and weekly visibility that is useful for real decisions.',
        },
        {
          title: 'Senior technical ownership',
          text: 'Critical architecture and release decisions stay in experienced hands.',
        },
        {
          title: 'Built-in controls',
          text: 'Security, maintainability, and release quality are integrated into delivery rather than added at the end.',
        },
        {
          title: 'Transfer-ready handover',
          text: 'Your team receives the documentation and context needed to keep velocity after the engagement.',
        },
      ],
      leadTeam: {
        label: 'Who leads the work',
        title: 'Lightheart is led by a compact product and engineering team.',
        description:
          'Instead of routing every decision through one founder profile, Lightheart brings together product leadership, senior technical ownership, and cloud architecture.',
        rolesLabel: 'Core leadership team',
        note:
          'The model stays intentionally tight so accountability remains visible, but it does not depend on a single individual.',
        roles: [
          {
            title: 'Product Lead',
            text: 'Frames the delivery outcome, scope boundaries, and decision cadence with stakeholders.',
          },
          {
            title: 'AI Tech Lead',
            text: 'Owns AI-supported implementation direction, review quality, and delivery tradeoffs during execution.',
          },
          {
            title: 'Cloud Architect',
            text: 'Validates architecture, reliability, security, and deployment choices across the platform.',
          },
        ],
        bullets: [
          'A single team can cover product, engineering, and infrastructure concerns without handoff gaps.',
          'Delivery decisions are challenged from multiple angles before they become release risk.',
          'The operating model remains narrow enough to stay accountable.',
        ],
      },
      fitGuidesTitle: 'Best fit and non-fit',
      fitGuides: [
        {
          title: 'Best fit',
          text: 'Product teams and software programs with a defined outcome, a real decision owner, and a need for senior-led delivery within real technical constraints.',
        },
        {
          title: 'Usually not a fit',
          text: 'Open-ended staff augmentation, undefined retainers, delivery without decision ownership, or work where accountability boundaries cannot be established.',
        },
      ],
      ctaPrimary: 'Request capability overview',
      ctaSecondary: 'Review WordClaw fit',
    },
    contact: {
      eyebrow: 'Contact',
      title: 'Tell us the delivery problem, the current constraint, and the outcome you need.',
      description:
        'Use this form for scoped delivery discussions, capability reviews, vendor reviews, or security follow-up.',
      formTitle: 'Send a message',
      formDescription:
        'This form is for real delivery, procurement, and assurance conversations. In this demo, the submit action is mocked locally.',
      formNote:
        'A polished brief is not required. A short note on the scope, constraint, and timeline is enough to start.',
      requestTypes: [
        'Capability overview',
        'Scoped delivery discussion',
        'Vendor overview',
        'Security or assurance request',
      ],
      fields: {
        nameLabel: 'Name',
        namePlaceholder: 'Your name',
        emailLabel: 'Email',
        emailPlaceholder: 'you@company.com',
        companyLabel: 'Company',
        companyPlaceholder: 'Company name',
        requestTypeLabel: 'Type of request',
        timelineLabel: 'Timeline',
        timelinePlaceholder: 'e.g. next 90 days or Q3',
        messageLabel: 'Delivery problem or notes',
        messagePlaceholder:
          'Describe the delivery problem, the current constraint, and the outcome you need',
      },
      successMessage:
        'Thanks. The demo accepted your request locally. A real deployment would hand this off to a custom contact workflow.',
      nextStepsTitle: 'What happens after you send this',
      nextSteps: [
        {
          title: 'We review the delivery problem',
          text: 'Lightheart looks at the request type, delivery constraint, and whether the work fits a sprint, product build phase, or strategic workstream.',
        },
        {
          title: 'We come back with a recommendation',
          text: 'You get either a fit direction, a clarifying question, or a clear no-fit if the model is not the right match.',
        },
        {
          title: 'We define the next step',
          text: 'If there is a fit, the next step is a short call, an async scope exchange, or a vendor/security follow-up.',
        },
      ],
      checklistTitle: 'Useful context to include',
      checklist: [
        'Current product or platform priorities for the next quarter.',
        'The workstream, release, or implementation area in scope.',
        'Quality, reliability, or governance constraints that cannot be compromised.',
        'Preferred engagement format and timeline.',
      ],
      directEmailTitle: 'Prefer async first?',
      directEmailText: 'Send a short scope outline to ',
    },
    wordclawFit: {
      eyebrow: 'WordClaw fit',
      title: 'Can a Lightheart-style website be built on WordClaw?',
      description:
        'Yes, with an important caveat: the content model fits well, but some of the marketing-site ergonomics still sit outside the product and need custom front-end or workflow work.',
      strongFitsTitle: 'What maps cleanly to WordClaw',
      strongFits: [
        'Marketing pages can be modeled as structured page records with section arrays and typed fields.',
        'Services, FAQs, case studies, leadership roles, and CTA strips all fit repeatable content types cleanly.',
        'Hero visuals, logos, and support imagery map to WordClaw asset records and delivery URLs.',
        'Approval-aware publishing is a good match for marketing copy review and controlled rollout.',
      ],
      gapsTitle: 'Current gaps or custom work',
      gaps: [
        {
          title: 'Localization workflow',
          text: 'WordClaw can store localized fields, but it does not yet ship a first-class translation workflow, locale fallback model, or bilingual editor UX.',
        },
        {
          title: 'Visual page composition',
          text: 'The runtime can store sectioned page data, but there is no visual page builder or marketing preview surface out of the box.',
        },
        {
          title: 'Website delivery tooling',
          text: 'SSR or static generation, route-aware SEO metadata, sitemap generation, and cache/preview ergonomics still belong to a custom front-end implementation.',
        },
        {
          title: 'Forms and outbound integrations',
          text: 'Contact routing, email delivery, and CRM or webhook integrations are outside the core product and need custom API or workflow glue.',
        },
      ],
      contentModelTitle: 'Suggested WordClaw content model',
      contentModels: [
        {
          name: 'site_settings',
          purpose: 'Header, footer, navigation, locale defaults, and global CTAs.',
          notes: 'One record per brand or per domain.',
        },
        {
          name: 'marketing_page',
          purpose: 'Page-level SEO fields plus an ordered array of typed section blocks.',
          notes: 'Each section block can carry localized copy and asset references.',
        },
        {
          name: 'service_offer',
          purpose: 'Reusable cards for service overviews, pricing teasers, and CTA panels.',
          notes: 'Pages can reference these instead of duplicating content.',
        },
        {
          name: 'case_study',
          purpose: 'Structured proof content with metadata, long-form fields, and supporting assets.',
          notes: 'Fits the current runtime very naturally.',
        },
        {
          name: 'contact_request',
          purpose: 'Inbound form payloads captured for review, routing, or follow-up.',
          notes: 'Needs a custom public-write or API workflow on top of WordClaw.',
        },
      ],
      verdictTitle: 'Verdict',
      verdict:
        'A site like lightheart.tech is feasible on top of WordClaw. The missing pieces are mostly authoring and delivery ergonomics, not a hard limit in the structured content model.',
    },
  },
  nl: {
    common: {
      languageLabel: 'Taal',
      contactEmailLabel: 'hello@lightheart.tech',
      fitNavLabel: 'WordClaw-fit',
      fitTeaserTitle: 'Kan WordClaw een site als deze dragen?',
      fitTeaserText:
        'Deze demo modelleert de Lightheart-site als gestructureerde pagina\'s, gelokaliseerde copy, herhaalbare secties en asset-verwijzingen, en maakt daarna de huidige gaten expliciet.',
      fitTeaserCta: 'Bekijk fit en gaten',
      demoFormNote:
        'Demo-opmerking: dit formulier simuleert alleen een submit. In een echte WordClaw-opzet loopt contactafhandeling via een custom API-route of workflow.',
      backHomeLabel: 'Terug naar home',
      homeLabel: 'Home',
      contactCta: 'Neem contact op',
    },
    header: {
      brandAlt: 'Lightheart Tech logo',
      ctaLabel: 'Neem contact op',
      navigation: [
        { path: '/services', label: 'Diensten' },
        { path: '/approach', label: 'Aanpak' },
        { path: '/case-studies', label: 'Cases' },
        { path: '/about', label: 'Over ons' },
      ],
    },
    footer: {
      eyebrow: 'Lightheart Tech',
      title: 'Product- en platformoplevering onder leiding van senior engineers.',
      description:
        'Lightheart helpt productteams en strategische softwareprogramma\'s om afgebakende werkstromen sneller op te leveren, met senior toezicht, releasediscipline en een overdracht waar een intern team direct mee verder kan.',
      columns: [
        {
          title: 'Bedrijf',
          links: [
            { path: '/', label: 'Home' },
            { path: '/services', label: 'Diensten' },
            { path: '/approach', label: 'Aanpak' },
            { path: '/about', label: 'Over ons' },
          ],
        },
        {
          title: 'Oplevering',
          links: [
            { path: '/case-studies', label: 'Cases' },
            { path: '/contact', label: 'Contact' },
            { path: '/wordclaw-fit', label: 'WordClaw-fit' },
          ],
        },
      ],
      contactCta: 'Vraag een capability-overzicht aan',
      copyright: 'Copyright {year} Lightheart Tech. Alle rechten voorbehouden.',
      legalNotice:
        'Deze demo is gebaseerd op de lokale lightheart.tech-broncode en aangepast om te testen hoe ver WordClaw een site met dezelfde contentpatronen kan dragen.',
    },
    home: {
      eyebrow: 'Lightheart Tech',
      heroTitle: 'Sneller opleveren zonder concessies aan kwaliteit.',
      heroDescription:
        'Lightheart levert product-, platform- en AI-projecten met senior engineers die verantwoordelijkheid nemen voor architectuur, kwaliteit en release. Je krijgt snelheid en een nette overdracht, geen rommel die later moet worden uitgezocht.',
      heroPrimaryCta: 'Neem contact op',
      heroSecondaryCta: 'Bekijk hoe we werken',
      serviceLabel: 'Diensten',
      serviceTitle: 'Drie manieren om met ons samen te werken.',
      serviceDescription:
        'Kies het model dat past bij jullie situatie: een gerichte sprint, een gestructureerde buildfase richting productie of ingebedde ondersteuning binnen een groter programma.',
      services: [
        {
          title: 'AI Delivery Sprint',
          summary:
            'Een gerichte sprint van 2 weken om een feature met hoge prioriteit of een release op te leveren, met senior engineers die elke stap beoordelen.',
          bullets: [
            'Ontwikkelteam met AI-ondersteuning',
            'Wekelijkse voortgangsupdates waar je op kunt sturen',
            'Releasechecklist en overdracht inbegrepen',
          ],
          href: '/services',
          linkLabel: 'Bekijk sprintdetails',
        },
        {
          title: 'Product Build Phase',
          summary:
            'Van gevalideerde scope naar een productieklare release, met duidelijke mijlpalen, echte afstemming en een overdracht waar je team direct mee verder kan.',
          bullets: [
            'Productieklare productincrement',
            'Database- en API-integraties',
            'Lanceringsvoorbereiding, stabilisatie en overdracht',
          ],
          href: '/services',
          linkLabel: 'Bekijk buildfase',
        },
        {
          title: 'Strategic Workstream Delivery',
          summary:
            'Een senior team dat in jullie programma instapt om een afgebakende platform-, integratie-, data- of AI-werkstroom te dragen binnen jullie governance en architectuur.',
          bullets: [
            'Helder eigenaarschap over de werkstroom',
            'Afstemming op architectuur, security en release',
            'Documentatie en transitiecontext voor interne teams',
          ],
          href: '/case-studies',
          linkLabel: 'Bekijk wanneer dit past',
        },
      ],
      snapshotLabel: 'Leveringsbeeld',
      snapshotTitle: 'Hoe zo\'n traject er in de praktijk uitziet',
      snapshotDescription:
        'De Lightheart-site verkoopt een senior-led delivery model. Dit zijn het soort herhaalbare narratieve blokken dat WordClaw netjes kan opslaan.',
      deliverySnapshots: [
        {
          label: 'Voor de bouw',
          title: 'We spreken precies af wat er wordt gebouwd',
          detail:
            'We starten met het businessresultaat, bakenen scope af en brengen risico\'s in kaart voordat we beginnen.',
          outcome:
            'Je weet wat er wordt opgeleverd, wat later komt en wat de release kan blokkeren.',
        },
        {
          label: 'Tijdens levering',
          title: 'Je ziet elke week echte voortgang',
          detail:
            'Updates laten zien wat is opgeleverd, welke risico\'s openstaan en welke beslissingen van jullie nodig zijn.',
          outcome: 'Geen vage statusupdates of onverwachte scope-uitbreiding.',
        },
        {
          label: 'Bij overdracht',
          title: 'Je team kan het direct overnemen',
          detail:
            'Documentatie, releasenotes en context worden meegeleverd zodat jullie team het werk direct kan onderhouden en uitbreiden.',
          outcome:
            'Geen reverse engineering. Geen kennishiaten bij de overdracht.',
        },
      ],
      qualityLabel: 'Kwaliteitsmodel',
      qualityTitle: 'Snel betekent niet slordig',
      qualityDescription:
        'AI maakt teams sneller, maar het werkmodel bepaalt de uitkomst. Deze demo houdt de Lightheart-boodschap intact en vertaalt die naar gestructureerde content.',
      qualityPillars: [
        'Elke pull request wordt beoordeeld door een senior engineer',
        'AI-gegenereerde code moet aan dezelfde kwaliteitslat voldoen als handgeschreven code',
        'Security- en betrouwbaarheidstests draaien standaard mee op elke wijziging',
        'Documentatie wordt geschreven voor jullie team, niet voor ons',
      ],
      sectorsLabel: 'Best fit',
      sectorsTitle: 'Voor wie dit model bedoeld is',
      sectorsDescription:
        'De originele site leunt op een mix van herbruikbare copyblokken en marketingbeelden. WordClaw kan content en assets beheren; de front-end blijft verantwoordelijk voor de presentatie.',
      sectors: [
        {
          title: 'Productreleases',
          detail: 'Wanneer roadmapdruk hoog is en de volgende mijlpaal niet mag schuiven.',
          image: '/img/best-fit-product-releases.png',
          alt: 'Product- en engineeringteam dat roadmapgrafieken beoordeelt tijdens een planningssessie',
        },
        {
          title: 'Platformfundament',
          detail: 'Wanneer architectuur, integraties en opleverdiscipline net zo belangrijk zijn als featuresnelheid.',
          image: '/img/best-fit-platform-foundations.png',
          alt: 'Senior architect die werkt aan cloudinfrastructuurtopologie aan een stabureau',
        },
        {
          title: 'Strategische werkstromen',
          detail: 'Wanneer een breder softwareprogramma senior inzet nodig heeft op een helder afgebakende scope.',
          image: '/img/best-fit-strategic-workstreams.png',
          alt: 'Senior leiderschapsteam dat deliverymetrics en projectscope bespreekt',
        },
      ],
      brandsLabel: 'Geselecteerde ondersteuning',
      brandsTitle: 'Teams die Lightheart heeft ondersteund',
      brandsDescription:
        'Een selectie van merken uit projecten waarin Lightheart oplevering, engineering en platformuitvoering heeft ondersteund.',
      faqLabel: 'Veelgestelde vragen',
      faqTitle: 'Vragen die teams stellen voor ze starten',
      faqDescription:
        'FAQ-items zijn opnieuw een nette WordClaw-fit: herhaalbare, gestructureerde en vertaalbare contentblokken.',
      faq: [
        {
          question: 'Vervangen jullie ons interne team?',
          answer:
            'Nee. Lightheart werkt naast jullie team op een afgebakende scope, bijvoorbeeld een sprint, een productbuildfase of een specifieke release.',
        },
        {
          question: 'Kunnen jullie binnen onze bestaande processen werken?',
          answer:
            'Ja. Lightheart sluit aan op jullie architectuur, releaseproces en governance in plaats van een nieuw model op te leggen.',
        },
        {
          question: 'Wat als inkoop documentatie nodig heeft?',
          answer:
            'Capability-overzichten, securitysamenvattingen en een juridische basis kunnen worden aangeleverd ter ondersteuning van een leveranciersreview.',
        },
        {
          question: 'Wat krijgen we als het project klaar is?',
          answer:
            'Werkende software, documentatie en een gestructureerde overdracht zodat jullie team het werk kan beheren en uitbreiden.',
        },
      ],
      contactTitle: 'Niet zeker welk model past? Laat ons helpen.',
      contactDescription:
        'Vertel ons wat het opleverprobleem is, wat de huidige beperking vormt en welke uitkomst je nodig hebt. We laten weten of dat past bij een sprint, buildfase of strategische werkstroom.',
    },
    services: {
      eyebrow: 'Diensten',
      title: 'Levermodellen voor echte softwarebeperkingen.',
      description:
        'Sommige klanten hebben genoeg aan een afgebakende sprint. Anderen hebben een duidelijke productfase of specialistische werkstroom binnen een breder programma nodig. Lightheart is voor beide ontworpen, zolang uitkomst, eigenaarschap en grenzen helder zijn.',
      serviceBlocks: [
        {
          title: 'AI Delivery Sprint',
          detail:
            'Een gerichte sprint van 2 weken voor teams die een release of implementatiepiek met hoge prioriteit snel willen realiseren, met senior toezicht.',
          points: [
            'Ontwikkelteam met AI-ondersteuning',
            'Wekelijkse voortgangsupdates met beslisinformatie',
            'Releasechecklist en overdracht inbegrepen',
          ],
          href: '/contact',
          linkLabel: 'Bespreek een sprint',
        },
        {
          title: 'Product Build Phase',
          detail:
            'Een gestructureerde buildfase voor teams die gevalideerde scope willen omzetten naar een productieklare release, met duidelijke checkpoints, stabilisatie en overdracht.',
          points: [
            'Productieklare productincrement',
            'Database- en API-integraties',
            'Authenticatie, onboarding en kernflows',
            'Lanceringsstabilisatie en overdracht',
          ],
          href: '/contact',
          linkLabel: 'Bespreek een buildfase',
        },
        {
          title: 'Strategic Workstream Delivery',
          detail:
            'Een specialistische trajectvorm voor bredere platform-, integratie-, data- en AI-programma\'s die een compact senior team nodig hebben voor een afgebakende werkstroom binnen bestaande governance.',
          points: [
            'Plan voor een afgebakende werkstroom',
            'Implementatie-eigenaarschap en architectuurafstemming',
            'Zicht op afhankelijkheden tussen teams',
            'Releasegereedheid en transitiedocumentatie',
          ],
          href: '/contact',
          linkLabel: 'Bespreek een werkstroom',
        },
      ],
      chooseTitle: 'Hoe je het juiste model kiest',
      chooseGuides: [
        {
          title: 'Kies AI Delivery Sprint als...',
          text: 'Je al een live product of platform hebt en sneller wilt opleveren op een afgebakende prioriteit.',
        },
        {
          title: 'Kies Product Build Phase als...',
          text: 'Je van gevalideerde scope naar een eerste productiegrens wilt, met expliciete checkpoints, stabilisatie en overdracht.',
        },
        {
          title: 'Kies Strategic Workstream Delivery als...',
          text: 'Je senior inzet nodig hebt binnen een breder platform-, integratie-, data- of AI-programma, terwijl governance en releasecontrole intact blijven.',
        },
      ],
      chooseNote:
        'Als de fit onduidelijk is, is het juiste antwoord om vroeg nee te zeggen in plaats van het werk in een pakket te duwen.',
      ctaPrimary: 'Vraag een capability-overzicht aan',
      ctaSecondary: 'Bekijk WordClaw-fit',
    },
    approach: {
      eyebrow: 'Aanpak',
      title: 'Zo organiseert Lightheart agile delivery binnen echte klantomgevingen.',
      description:
        'De Lightheart-site is grotendeels een reeks gestructureerde secties met verschillende visuele behandelingen. Deze pagina behoudt dat patroon en laat tegelijk zien waar WordClaw sterk is en waar custom site-logica nodig blijft.',
      phases: [
        {
          title: '1. Afbakenen',
          text: 'Stem businessresultaat, scopegrenzen, acceptatiecriteria, beperkingen en bekende risico\'s op elkaar af voordat delivery start.',
        },
        {
          title: '2. Plan',
          text: 'Vertaal de afgebakende uitkomst naar backlog, sprintritme, architectuuraanpak en release-aannames.',
        },
        {
          title: '3. Sprintuitvoering',
          text: 'Lever in korte iteraties, met bespreekbare increments, senior technisch toezicht en expliciete afwegingen.',
        },
        {
          title: '4. Valideren en releasen',
          text: 'Voer test-, security-, architectuur-, omgevings- en releasegereedheidschecks uit voordat een go/no-go-besluit wordt genomen.',
        },
        {
          title: '5. Overdragen of beheren',
          text: 'Sluit af met overdrachtsklare documentatie en kennisoverdracht, of ga door in een duidelijk onderhoudspad.',
        },
      ],
      methodsTitle: 'Bewezen disciplines achter het model',
      methodsDescription:
        'Elk van deze kaarten kan worden opgeslagen als herhaalbaar, gestructureerd blok in plaats van als een grote rich-textpagina.',
      methods: [
        {
          title: 'Agile delivery',
          text: 'Backlogsturing, sprintplanning, refinement, demo\'s en retrospectives houden voortgang zichtbaar en besluitvorming snel.',
        },
        {
          title: 'DevOps-automatisering',
          text: 'CI/CD, infrastructure as code, reproduceerbare omgevingen en releaseautomatisering verkleinen handmatig opleverrisico.',
        },
        {
          title: 'DevSecOps-controles',
          text: 'Securitychecks, dependency reviews, secretsbeheer en releasegates zitten in de workflow.',
        },
        {
          title: 'SRE en observability',
          text: 'Monitoring, runbooks, incidentgereedheid en betrouwbaarheidsdenken zorgen dat releases ook na livegang beheersbaar blijven.',
        },
        {
          title: 'FinOps-discipline',
          text: 'Cloudkosten en afwegingen tussen kosten en performance worden waar relevant meegenomen in delivery.',
        },
        {
          title: 'Architectuurborging',
          text: 'Belangrijke technische beslissingen worden vastgelegd en beoordeeld voordat ze releaserisico worden.',
        },
      ],
      cadenceTitle: 'Hoe werk week na week loopt',
      cadenceDescription:
        'Nog een sterke content-runtime-fit: een pagina opgebouwd uit consistente, getypeerde narratieve secties.',
      cadenceItems: [
        {
          title: 'Backlog refinement en sprintplanning',
          text: 'Houd scope actueel, knip werk op in beslisklare increments en bevestig wat de volgende sprint ingaat.',
        },
        {
          title: 'Asynchrone updates en actief risicomanagement',
          text: 'Open risico\'s, blokkades en beslissingen worden continu zichtbaar gemaakt in plaats van pas aan het einde van de week.',
        },
        {
          title: 'Bespreekbare voortgang per sprint',
          text: 'Demo\'s, technische review en stakeholderfeedback zijn ingebouwd in het werkritme.',
        },
        {
          title: 'Go/no-go-discipline voor releases',
          text: 'Releasegereedheid is een expliciet besluit met kwaliteits-, security-, operationele en eigenaarschapschecks.',
        },
      ],
      controlsTitle: 'Operationele controles die kwaliteit bewaken, ook onder hoge snelheid',
      controls: [
        'Architectuurbeslissingen worden beoordeeld en vastgelegd in een herleidbaar beslislog.',
        'AI-gegenereerde code doorloopt dezelfde review-, test- en release-eisen als handgeschreven code.',
        'CI bevat tests, securitychecks en waar relevant validatie op betrouwbaarheid of performance.',
        'Overdracht of doorlopende ondersteuning wordt vooraf afgesproken als expliciet opleverresultaat.',
      ],
      visibilityTitle: 'Waar klanten echt zicht op krijgen',
      visibilityDescription:
        'Het model is ontworpen om je betrokken te houden bij beslissingen zonder je de dagelijkse uitvoering in te trekken.',
      visibilityItems: [
        {
          title: 'Een afgebakende mijlpaal',
          text: 'De kickoff maakt businessresultaat, technische grenzen, acceptatiecriteria en wat bewust buiten scope blijft helder.',
        },
        {
          title: 'Beslisklare rapportage',
          text: 'Updates tonen opgeleverd werk, open risico\'s, openstaande beslissingen en de volgende actie of goedkeuring die nodig is.',
        },
        {
          title: 'Artefacten die bruikbaar blijven',
          text: 'Backlogcontext, releasenotes, documentatie, runbooks en beslislogboeken worden zo opgebouwd dat het werk ook na het traject bruikbaar blijft.',
        },
      ],
      clientRequirementsTitle: 'Wat het model aan klantzijde nodig heeft',
      clientRequirementsDescription:
        'Dit is een goed voorbeeld van content die WordClaw kan opslaan, maar niet zelfstandig operationeel kan afdwingen.',
      clientRequirements: [
        'Een echte beslisser die snel scope- en prioriteitsbesluiten kan nemen.',
        'Toegang tot de relevante codebase, backlogtools, omgevingen en opleverbeperkingen.',
        'Een gedeelde definitie van done, releaseproces, securityverwachtingen en documentatieverwachtingen.',
        'Beschikbaarheid voor wekelijkse reviews, unblock-momenten en sprint- of releasebesluiten.',
      ],
      endStatesTitle: 'Kies de eindvorm die bij het traject past',
      endStatesDescription:
        'De delivery-story eindigt in overdracht of in doorlopende ondersteuning. Beide zijn gestructureerde uitkomsten die WordClaw helder kan representeren.',
      endStates: [
        {
          title: 'Overdracht aan jullie team',
          text: 'Past het best wanneer jullie eigen engineers de roadmap na release verder oppakken en direct bruikbare context nodig hebben.',
          points: [
            'Handover-documentatie en releasecontext',
            'Kennisoverdracht met jullie team',
            'Heldere overgang van eigenaarschap en aanbevelingen voor de volgende fase',
          ],
        },
        {
          title: 'SLA-gedragen beheer en ondersteuning',
          text: 'Past het best wanneer continuiteit na livegang of een beheerde stabilisatiefase nodig is.',
          points: [
            'Afspraken over supportscope, responstijden en escalatie',
            'Bugfixing, onderhoud en gecontroleerde vervolgwijzigingen',
            'Operationele continuiteit zonder concessies aan release-discipline',
          ],
        },
      ],
      ctaPrimary: 'Bespreek je scope',
      ctaSecondary: 'Bekijk fit en gaten',
    },
    caseStudies: {
      eyebrow: 'Cases',
      title: 'Geselecteerde deliveryvoorbeelden met afgebakende scope, zichtbaar eigenaarschap en concrete uitkomsten.',
      description:
        'Cases zijn een van de schoonste WordClaw-fits in de hele site: gestructureerde records met herhaalbare metadata, lange tekstvelden en asset-verwijzingen.',
      proofPointsTitle: 'Wat deze cases laten zien',
      proofPoints: [
        'Productleiding onder tijdsdruk',
        'Platformherbouw en operationele schaalbaarheid',
        'Betrouwbaarheid van enterprise-datapipelines',
        'Infrastructuurdelivery in gereguleerde, hoge-beschikbaarheidsomgevingen',
        'Eigenaarschap over afgebakende werkstromen binnen echte deliverybeperkingen',
      ],
      scopeLabel: 'Scope',
      roleLabel: 'Rol',
      environmentLabel: 'Omgeving',
      outcomeTypeLabel: 'Type uitkomst',
      challengeTitle: 'Uitdaging',
      ownershipTitle: 'Wat Lightheart voor zijn rekening nam',
      deliveredTitle: 'Wat is opgeleverd',
      outcomeTitle: 'Uitkomst',
      capabilityTitle: 'Welke huidige Lightheart-capaciteit dit laat zien',
      items: [
        {
          title: 'Klarna x Shopify integratie',
          context:
            'Delivery van een commerce-integratie voor Klarna op Shopify, met productrichting, partnerafstemming en lancering in een lijn.',
          scope: 'End-to-end productoplevering van scopebepaling tot lancering.',
          role: 'Productleiding en uitvoering van het traject.',
          environment: 'Partnergerichte commerce-integratie in Shopify.',
          outcomeType: 'Productdelivery die klaar is voor lancering.',
          challenge:
            'Klarna moest een Shopify-integratie opleveren die betrouwbaar werkte voor verschillende webshopconfiguraties, met strakke coordinatie tussen product, engineering en partnervereisten.',
          ownership:
            'Lightheart leidde de productafbakening, de prioritering van de implementatie en de lancering, en zorgde dat engineering, QA en partnerafhankelijkheden aangesloten bleven.',
          delivered:
            'Een productieklare Shopify-integratie, gebouwd met heldere scopegrenzen, partnerafstemming en gestructureerde overdrachtsdocumentatie.',
          outcome:
            'De integratie lanceerde op schema met soepele ingebruikname door webshops en zonder herstelwerk door onduidelijke scope.',
          capability:
            'Eigenaarschap over productwerkstromen waar scope, partnercoordinatie, releaseplanning en overdracht op elkaar moeten blijven aansluiten.',
        },
        {
          title: 'Eyecons platformherbouw voor schaalbaarheid',
          context:
            'Volledige platformherbouw voor een AI-gedreven product voor live sportopnames dat over meerdere locaties moest kunnen schalen zonder operationele fragiliteit.',
          scope: 'Herontwerp van applicatiearchitectuur, infrastructuurherbouw en een Kubernetes-platform.',
          role: 'AI Tech Lead en Cloud Architect.',
          environment: 'AI-gedreven live sports SaaS op Kubernetes.',
          outcomeType: 'Platformschaalbaarheid en operationele betrouwbaarheid.',
          challenge:
            'De bestaande applicatiearchitectuur en infrastructuur konden schaal over meerdere locaties niet dragen. De volledige stack moest opnieuw worden opgebouwd.',
          ownership:
            'Lightheart herbouwde de volledige applicatiearchitectuur en infrastructuur en ontwierp het systeem opnieuw op Kubernetes met een microservices-aanpak.',
          delivered:
            'Een geherarchitecteerd platform op Kubernetes met nieuwe applicatiestructuur, nieuwe infrastructuur en een schaalbaar fundament.',
          outcome:
            'Eyecons ging van een platform dat niet kon schalen naar een architectuur voor uitrol over meerdere locaties en confident intern eigenaarschap.',
          capability:
            'Platformherbouw, cloudarchitectuur en betrouwbaarheidsgedreven delivery voor producten die de oorspronkelijke stack zijn ontgroeid.',
        },
        {
          title: 'Inter IKEA enterprise ETL-pipeline',
          context:
            'Werk aan verwerking en validatie van grote datavolumes voor supply chain-operaties waar fouten in datakwaliteit niet downstream mochten doorlekken.',
          scope: 'Pipeline-architectuur, datavalidatieontwerp en operationele betrouwbaarheid.',
          role: 'Cloud Architect en lead technisch ontwerp.',
          environment: 'Enterprise supply chain-dataomgeving.',
          outcomeType: 'Operationele databetrouwbaarheid.',
          challenge:
            'Inter IKEA had een ETL-pipeline nodig die grote volumes supply chain-data kon verwerken met strenge validatievereisten.',
          ownership:
            'Lightheart ontwierp de ETL-pipelinearchitectuur, definieerde de validatieaanpak en maakte de infrastructuurbeslissingen die operationele robuustheid vormgaven.',
          delivered:
            'Een ETL-architectuur voor het verwerken van grote datavolumes met ingebouwde validatiestappen en helder operationeel eigenaarschap.',
          outcome:
            'De pipeline ondersteunde enterprise-verwerkingseisen betrouwbaar en ving datakwaliteitsproblemen af voordat ze downstreamsystemen bereikten.',
          capability:
            'Afgebakende data- en integratiewerkstromen waarin architectuur, validatie en operationele robuustheid net zo zwaar wegen als implementatiesnelheid.',
        },
        {
          title: 'Schiphol mapping en kioskinfrastructuur',
          context:
            'Infrastructuur- en applicatiedelivery voor Schiphol interne mapping en passagiersgerichte selfservice-kiosken onder operationele luchthavenbeperkingen.',
          scope:
            'Architectuur van het mappingplatform, kioskapplicatie-infrastructuur en integratie met operationele luchthavensystemen.',
          role: 'Cloud Architect en lead platformdelivery.',
          environment: 'Luchthavenoperatie-infrastructuur met hoge beschikbaarheid.',
          outcomeType: 'Operationele platformdelivery en passagiers-selfservicecapabiliteit.',
          challenge:
            'Schiphol had een betrouwbaar intern mappingplatform en selfservice-kioskinfrastructuur nodig binnen strenge uptime- en securityvereisten.',
          ownership:
            'Lightheart ontwierp en leverde de architectuur van het mappingplatform en de kioskinfrastructuurlaag, inclusief deploymentpipelines en operationele tooling.',
          delivered:
            'Een productie-mappingplatform plus schaalbare kioskinfrastructuur, geintegreerd met bestaande operationele en securitysystemen.',
          outcome:
            'Schiphol kreeg een onderhoudbare mappingcapabiliteit en een selfservice-kiosknetwerk dat op luchthavenschaal draait.',
          capability:
            'Infrastructuurzware platformdelivery in gereguleerde, hoge-beschikbaarheidsomgevingen waar uptime, security en enterprise-integratie niet onderhandelbaar zijn.',
        },
      ],
      ctaPrimary: 'Neem contact op',
    },
    about: {
      eyebrow: 'Over ons',
      title: 'Een compact senior team voor trajecten waar snelheid en volwassen technisch toezicht samen moeten gaan.',
      description:
        'Veel teams kunnen met AI sneller code schrijven. Minder teams kunnen die snelheid in productie brengen zonder kwaliteitschuld, securityzorgen of instabiele releases te veroorzaken.',
      principles: [
        {
          title: 'Praktische AI-inzet',
          text: 'AI wordt toegepast waar het aantoonbaar snelheid en consistentie verhoogt, niet als vervanging van engineeringoordeel.',
        },
        {
          title: 'Bewust compact',
          text: 'Het werkmodel blijft bewust compact zodat eigenaarschap zichtbaar blijft in plaats van diffuus te worden.',
        },
        {
          title: 'Senior verantwoordelijkheid',
          text: 'Senior engineers blijven verantwoordelijk voor architectuurkwaliteit, codebasegezondheid en release-uitkomsten.',
        },
      ],
      expectationTitle: 'Wat je mag verwachten',
      expectations: [
        {
          title: 'Duidelijk werkritme',
          text: 'Heldere mijlpalen, expliciete afwegingen en wekelijkse zichtbaarheid waar je echt beslissingen op kunt nemen.',
        },
        {
          title: 'Senior technisch eigenaarschap',
          text: 'Kritieke architectuur- en releasebeslissingen blijven in ervaren handen.',
        },
        {
          title: 'Ingebouwde controles',
          text: 'Security, onderhoudbaarheid en releasekwaliteit zijn onderdeel van het traject in plaats van iets dat achteraf wordt toegevoegd.',
        },
        {
          title: 'Overdracht klaar voor je interne team',
          text: 'Je team ontvangt documentatie en context om na de samenwerking met snelheid door te gaan.',
        },
      ],
      leadTeam: {
        label: 'Wie het werk leidt',
        title: 'Lightheart wordt geleid door een compact product- en engineeringteam.',
        description:
          'In plaats van alle beslissingen via een oprichtersprofiel te laten lopen, combineert Lightheart productleiding, senior technisch eigenaarschap en cloudarchitectuur.',
        rolesLabel: 'Kernteam',
        note:
          'Het model blijft bewust compact zodat eigenaarschap zichtbaar blijft, maar is niet afhankelijk van een enkel individu.',
        roles: [
          {
            title: 'Product Lead',
            text: 'Kadert het beoogde resultaat, de scopegrenzen en het beslisritme met stakeholders.',
          },
          {
            title: 'AI Tech Lead',
            text: 'Stuurt AI-ondersteunde implementatierichting, reviewkwaliteit en technische afwegingen tijdens uitvoering.',
          },
          {
            title: 'Cloud Architect',
            text: 'Valideert architectuur, betrouwbaarheid, security en deploymentkeuzes over het hele platform.',
          },
        ],
        bullets: [
          'Een team kan product-, engineering- en infrastructuurvragen afdekken zonder overdrachtsgaten.',
          'Opleverbeslissingen worden vanuit meerdere invalshoeken getoetst voordat ze releaserisico worden.',
          'Het operating model blijft smal genoeg voor echte verantwoordelijkheid.',
        ],
      },
      fitGuidesTitle: 'Waar we wel en niet bij passen',
      fitGuides: [
        {
          title: 'Past het best',
          text: 'Productteams en softwareprogramma\'s met een duidelijke uitkomst, een echte beslisser en behoefte aan delivery onder leiding van senior engineers binnen echte technische grenzen.',
        },
        {
          title: 'Past meestal niet',
          text: 'Open teamuitbreiding, ongedefinieerde retainers, delivery zonder beslis-eigenaarschap of werk waarbij verantwoordelijkheidsgrenzen niet scherp te krijgen zijn.',
        },
      ],
      ctaPrimary: 'Vraag een capability-overzicht aan',
      ctaSecondary: 'Bekijk WordClaw-fit',
    },
    contact: {
      eyebrow: 'Contact',
      title: 'Vertel ons welk opleverprobleem je hebt, wat de huidige beperking is en welke uitkomst je nodig hebt.',
      description:
        'Gebruik dit formulier voor gesprekken over afgebakende oplevering, capability-overzichten, leveranciersbeoordelingen of securityopvolging.',
      formTitle: 'Stuur ons je vraag',
      formDescription:
        'Dit formulier is bedoeld voor serieuze gesprekken over oplevering, inkoop en assurance. In deze demo is de submit lokaal gemockt.',
      formNote:
        'Een uitgewerkte brief is niet nodig. Een korte notitie over scope, beperking en tijdlijn is genoeg om te starten.',
      requestTypes: [
        'Capability-overzicht',
        'Gesprek over afgebakende oplevering',
        'Leveranciersreview',
        'Security- of assuranceverzoek',
      ],
      fields: {
        nameLabel: 'Naam',
        namePlaceholder: 'Je naam',
        emailLabel: 'E-mail',
        emailPlaceholder: 'jij@bedrijf.com',
        companyLabel: 'Bedrijf',
        companyPlaceholder: 'Bedrijfsnaam',
        requestTypeLabel: 'Type aanvraag',
        timelineLabel: 'Tijdlijn',
        timelinePlaceholder: 'bijv. komende 90 dagen of Q3',
        messageLabel: 'Opleverprobleem of notities',
        messagePlaceholder:
          'Omschrijf het opleverprobleem, de huidige beperking en de uitkomst die je nodig hebt',
      },
      successMessage:
        'Bedankt. De demo heeft je aanvraag lokaal geaccepteerd. In een echte deployment wordt dit doorgezet naar een custom contactworkflow.',
      nextStepsTitle: 'Wat er gebeurt nadat je dit verstuurt',
      nextSteps: [
        {
          title: 'We beoordelen het leveringsprobleem',
          text: 'Lightheart kijkt naar het type aanvraag, de opleverbeperking en of het werk past bij een sprint, buildfase of strategische werkstroom.',
        },
        {
          title: 'We komen terug met een aanbeveling',
          text: 'Je krijgt een richting, een verduidelijkende vraag of een duidelijke terugkoppeling dat dit model niet past.',
        },
        {
          title: 'We bepalen de volgende stap',
          text: 'Als er een passende route is, volgt een korte call, asynchrone scope-uitwisseling of leveranciers- of securityopvolging.',
        },
      ],
      checklistTitle: 'Handige context om mee te sturen',
      checklist: [
        'Huidige product- of platformprioriteiten voor het komende kwartaal.',
        'De werkstroom, release of implementatiezone die in scope is.',
        'Kwaliteits-, betrouwbaarheids- of governance-eisen waar je niet op kunt inleveren.',
        'Gewenste samenwerkingsvorm en tijdlijn.',
      ],
      directEmailTitle: 'Liever eerst asynchroon?',
      directEmailText: 'Mail een korte scopebeschrijving naar ',
    },
    wordclawFit: {
      eyebrow: 'WordClaw-fit',
      title: 'Kan een Lightheart-achtige website op WordClaw worden gebouwd?',
      description:
        'Ja, met een belangrijke kanttekening: het contentmodel past goed, maar een deel van de ergonomie van een marketingsite ligt nog buiten het product en vraagt om custom front-end- of workflowwerk.',
      strongFitsTitle: 'Wat schoon op WordClaw past',
      strongFits: [
        'Marketingpagina\'s kunnen worden gemodelleerd als gestructureerde paginarecords met sectie-arrays en getypeerde velden.',
        'Diensten, FAQ\'s, cases, teamrollen en CTA-strips passen schoon in herhaalbare contenttypes.',
        'Hero-afbeeldingen, logo\'s en ondersteunende beelden passen op WordClaw-assetrecords en delivery-URL\'s.',
        'Approval-aware publishing is een goede match voor review en gecontroleerde uitrol van marketingcopy.',
      ],
      gapsTitle: 'Huidige gaten of custom werk',
      gaps: [
        {
          title: 'Lokalisatieworkflow',
          text: 'WordClaw kan gelokaliseerde velden opslaan, maar levert nog geen first-class vertaalworkflow, locale-fallbackmodel of tweetalige editor-UX.',
        },
        {
          title: 'Visuele paginacompositie',
          text: 'De runtime kan gestructureerde paginadata opslaan, maar er is geen visuele page builder of marketing-preview out of the box.',
        },
        {
          title: 'Website-delivery tooling',
          text: 'SSR of static generation, route-afhankelijke SEO-metadata, sitemapgeneratie en cache/preview-ergonomie horen nog bij een custom front-endimplementatie.',
        },
        {
          title: 'Formulieren en outbound-integraties',
          text: 'Contactrouting, e-maildelivery en CRM- of webhookintegraties vallen buiten het kernproduct en vragen om custom API- of workflowlijm.',
        },
      ],
      contentModelTitle: 'Voorgesteld WordClaw-contentmodel',
      contentModels: [
        {
          name: 'site_settings',
          purpose: 'Header, footer, navigatie, locale-standaarden en globale CTA\'s.',
          notes: 'Een record per merk of per domein.',
        },
        {
          name: 'marketing_page',
          purpose: 'SEO-velden op paginaniveau plus een geordende array van getypeerde sectieblokken.',
          notes: 'Elk sectieblok kan gelokaliseerde copy en asset-verwijzingen dragen.',
        },
        {
          name: 'service_offer',
          purpose: 'Herbruikbare kaarten voor dienstoverzichten, pricing-teasers en CTA-panelen.',
          notes: 'Pagina\'s kunnen hiernaar verwijzen in plaats van copy te dupliceren.',
        },
        {
          name: 'case_study',
          purpose: 'Gestructureerde proof-content met metadata, langetekstvelden en ondersteunende assets.',
          notes: 'Sluit heel natuurlijk aan op de huidige runtime.',
        },
        {
          name: 'contact_request',
          purpose: 'Inkomende formulierpayloads vastleggen voor review, routing of opvolging.',
          notes: 'Vraagt om een custom public-write of API-workflow boven op WordClaw.',
        },
      ],
      verdictTitle: 'Oordeel',
      verdict:
        'Een site als lightheart.tech is haalbaar boven op WordClaw. De ontbrekende stukken zitten vooral in authoring- en delivery-ergonomie, niet in een harde limiet van het gestructureerde contentmodel.',
    },
  },
}
