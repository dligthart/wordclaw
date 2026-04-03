const state = {
  bootstrap: null,
  session: null,
  dashboard: null,
  selectedProposalId: null,
  authMode: 'register',
  flash: null,
  requestFlash: null,
  requestDraft: null,
  loading: true,
}

const app = document.querySelector('#app')

const SECTION_LABELS = {
  executiveSummary: 'Executive Summary',
  currentSituation: 'Current Situation',
  scopeSummary: 'Scope Summary',
  recommendedApproach: 'Recommended Approach',
  deliveryPlan: 'Delivery Plan',
  assumptions: 'Assumptions',
  nextSteps: 'Next Steps',
}

async function api(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  }

  const response = await fetch(path, {
    credentials: 'same-origin',
    headers,
    ...options,
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message =
      payload?.error ||
      payload?.message ||
      payload?.remediation ||
      `Request failed with ${response.status}`
    throw new Error(message)
  }

  return payload
}

function formatDateTime(value) {
  if (!value) return 'Unknown time'
  return new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatRelativeTime(value) {
  if (!value) return ''
  const diff = Date.now() - new Date(value).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatRichText(value) {
  return String(value)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('')
}

function readSelectedProposalIdFromLocation() {
  const rawValue = new URL(window.location.href).searchParams.get('proposal')
  const proposalId = Number(rawValue)
  return Number.isInteger(proposalId) && proposalId > 0 ? proposalId : null
}

function proposalHref(proposalId) {
  const url = new URL(window.location.href)
  url.searchParams.set('proposal', String(proposalId))
  url.hash = 'proposal-reader'
  return `${url.pathname}${url.search}${url.hash}`
}

function syncSelectedProposalLocation(proposalId) {
  const url = new URL(window.location.href)
  if (proposalId) {
    url.searchParams.set('proposal', String(proposalId))
    url.hash = 'proposal-reader'
  } else {
    url.searchParams.delete('proposal')
    if (url.hash === '#proposal-reader') {
      url.hash = ''
    }
  }

  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

function setSelectedProposal(proposalId, options = {}) {
  if (!Number.isInteger(proposalId) || proposalId <= 0) {
    return
  }

  state.selectedProposalId = proposalId
  syncSelectedProposalLocation(proposalId)
  render()

  if (options.scroll !== false) {
    window.requestAnimationFrame(() => {
      document.querySelector('#proposal-reader')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function visibleProposalSections(proposal) {
  return Object.entries(SECTION_LABELS)
    .map(([key, label]) => {
      const value = proposal?.data?.[key]
      if (typeof value !== 'string' || !value.trim()) {
        return ''
      }

      return `
        <article class="proposal-reader-section">
          <h4>${label}</h4>
          <div class="proposal-rich-copy">${formatRichText(value)}</div>
        </article>
      `
    })
    .filter(Boolean)
    .join('')
}

function createRequestDraft(user = {}) {
  return {
    projectName: '',
    budgetRange: '',
    requestedOutcome: '',
    currentSituation: '',
    keyRequirements: '',
    constraints: '',
    companyName: user.companyName || '',
    targetTimeline: '',
  }
}

function captureFocusState() {
  const active = document.activeElement
  if (
    !app.contains(active) ||
    !(
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement
    )
  ) {
    return null
  }

  return {
    formId: active.form?.id || null,
    name: active.name || null,
    id: active.id || null,
    selectionStart:
      active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
        ? active.selectionStart
        : null,
    selectionEnd:
      active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
        ? active.selectionEnd
        : null,
  }
}

function restoreFocusState(focusState) {
  if (!focusState) {
    return
  }

  let selector = null
  if (focusState.id) {
    selector = `#${CSS.escape(focusState.id)}`
  } else if (focusState.name) {
    const fieldSelector = `[name="${CSS.escape(focusState.name)}"]`
    selector = focusState.formId
      ? `#${CSS.escape(focusState.formId)} ${fieldSelector}`
      : fieldSelector
  }

  if (!selector) {
    return
  }

  const nextActive = document.querySelector(selector)
  if (
    !(
      nextActive instanceof HTMLInputElement ||
      nextActive instanceof HTMLTextAreaElement ||
      nextActive instanceof HTMLSelectElement
    )
  ) {
    return
  }

  nextActive.focus({ preventScroll: true })
  if (
    typeof focusState.selectionStart === 'number' &&
    typeof focusState.selectionEnd === 'number' &&
    (nextActive instanceof HTMLInputElement || nextActive instanceof HTMLTextAreaElement)
  ) {
    nextActive.setSelectionRange(focusState.selectionStart, focusState.selectionEnd)
  }
}

/* ─── Icons (inline SVG for crispness) ─── */
const ICONS = {
  sparkle: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1L9.5 6.5L15 8L9.5 9.5L8 15L6.5 9.5L1 8L6.5 6.5L8 1Z" fill="currentColor" opacity="0.9"/></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  warning: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 5V9M8 11.5V11M3 14H13L8 2L3 14Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  send: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 2L7 9M14 2L10 14L7 9M14 2L2 6L7 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  clock: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V8L10.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  document: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 2H10L13 5V14H4V2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 8H11M6 10.5H11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  user: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 14C2.5 11 5 9 8 9C11 9 13.5 11 13.5 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  logout: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 2H3V14H6M11 4L15 8L11 12M5.5 8H14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  refresh: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 8C2 4.7 4.7 2 8 2C10.4 2 12.4 3.5 13.3 5.5M14 8C14 11.3 11.3 14 8 14C5.6 14 3.6 12.5 2.7 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M13 2V6H9M3 14V10H7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  external: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 3H3V13H13V10M9 3H13V7M13 3L7 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  arrow: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 8H13M9 4L13 8L9 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
}

function statusIcon(status) {
  switch (status) {
    case 'submitted': return ICONS.clock
    case 'generating': return ICONS.sparkle
    case 'awaiting_review': return ICONS.clock
    case 'published': return ICONS.check
    case 'failed':
    case 'rejected': return ICONS.warning
    default: return ICONS.clock
  }
}

/* ─── Render functions ─── */

function renderHero() {
  const bootstrap = state.bootstrap
  const reviewer = bootstrap?.reviewer ?? {}
  const providerLabel = bootstrap?.providerLabel ?? 'deterministic demo worker'
  return `
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">${ICONS.sparkle} WordClaw Demo</span>
        <h1>Proposal Portal</h1>
        <p>
          Submit a project brief. An AI draft is generated, reviewed by a human approver,
          and delivered to your account — all powered by WordClaw's content pipeline.
        </p>
        <div class="hero-meta">
          <article class="meta-card">
            <strong>Draft engine</strong>
            <span>${escapeHtml(providerLabel)}</span>
          </article>
          <article class="meta-card">
            <strong>Workflow</strong>
            <span>Brief → AI draft → Human review → Published</span>
          </article>
          <article class="meta-card">
            <strong>Reviewer UI</strong>
            <span><a href="${escapeHtml(bootstrap?.reviewer?.loginUrl || '#')}" target="_blank" rel="noreferrer">Open supervisor ${ICONS.external}</a></span>
          </article>
        </div>
      </div>
      <aside class="review-card">
        <div>
          <strong>Reviewer credentials</strong>
          <span>Sign into the WordClaw supervisor to approve or reject generated proposals.</span>
        </div>
        <code>${escapeHtml(reviewer.email || 'reviewer@proposal-demo.local')}
${escapeHtml(reviewer.password || 'WordClawDemo!2026')}</code>
        <ol class="notice-list">
          <li>Sign in to the supervisor UI</li>
          <li>Open the approval queue</li>
          <li>Approve the proposal for the client to see it</li>
        </ol>
        <a class="button-link button-secondary" href="${escapeHtml(reviewer.approvalsUrl || '#')}" target="_blank" rel="noreferrer">${ICONS.external} Open approval queue</a>
      </aside>
    </section>
  `
}

function renderFlash(flash, className = '') {
  if (!flash) {
    return `<div class="flash ${className}" data-visible="false"></div>`
  }

  const icon = flash.type === 'success' ? ICONS.check : ICONS.warning
  return `
    <div class="flash ${className} ${flash.type}" data-visible="true">
      <div class="flash-header">${icon} <strong>${escapeHtml(flash.title)}</strong></div>
      <span>${escapeHtml(flash.body)}</span>
    </div>
  `
}

function renderAuth() {
  const registerActive = state.authMode === 'register'
  return `
    <section class="two-up">
      <article class="auth-card">
        <div class="auth-switch">
          <button class="${registerActive ? 'button-primary' : 'button-secondary'} tab-button" data-auth-mode="register">${ICONS.user} Create account</button>
          <button class="${!registerActive ? 'button-primary' : 'button-secondary'} tab-button" data-auth-mode="login">${ICONS.arrow} Sign in</button>
        </div>
        <h2>${registerActive ? 'Get started' : 'Welcome back'}</h2>
        <p class="auth-subtitle">
          ${registerActive
            ? 'Create an account to submit project briefs and receive AI-generated proposals.'
            : 'Sign in to view your proposals and submit new briefs.'}
        </p>
        ${renderFlash(state.flash)}
        <form id="${registerActive ? 'register-form' : 'login-form'}">
          ${registerActive ? `
            <div class="field-row">
              <label>
                <span>Full name</span>
                <input name="fullName" autocomplete="name" placeholder="Jane Smith" required />
              </label>
              <label>
                <span>Company</span>
                <input name="companyName" autocomplete="organization" placeholder="Acme Corp" required />
              </label>
            </div>
          ` : ''}
          <label>
            <span>Email</span>
            <input name="email" autocomplete="email" type="email" placeholder="you@company.com" required />
          </label>
          <label>
            <span>Password</span>
            <input name="password" autocomplete="${registerActive ? 'new-password' : 'current-password'}" type="password" minlength="8" placeholder="${registerActive ? 'Min. 8 characters' : '••••••••'}" required />
          </label>
          <button class="button-primary" type="submit">${registerActive ? `${ICONS.user} Create account` : `${ICONS.arrow} Sign in`}</button>
        </form>
      </article>
      <section class="section how-it-works">
        <h2>How it works</h2>
        <p>This demo exercises the full WordClaw content pipeline end-to-end.</p>
        <div class="steps-grid">
          <article class="step-card">
            <div class="step-number">1</div>
            <div class="step-content">
              <strong>Submit a brief</strong>
              <span>A form submission creates a WordClaw content item.</span>
            </div>
          </article>
          <article class="step-card">
            <div class="step-number">2</div>
            <div class="step-content">
              <strong>AI generates a draft</strong>
              <span>A background job creates a proposal from your brief.</span>
            </div>
          </article>
          <article class="step-card">
            <div class="step-number">3</div>
            <div class="step-content">
              <strong>Human reviews</strong>
              <span>A reviewer approves or rejects the draft in the supervisor.</span>
            </div>
          </article>
          <article class="step-card">
            <div class="step-number">4</div>
            <div class="step-content">
              <strong>Proposal delivered</strong>
              <span>Approved proposals appear in your account, ready to read.</span>
            </div>
          </article>
        </div>
      </section>
    </section>
  `
}

function renderRequests(requests) {
  if (!requests.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon">${ICONS.document}</div>
        <strong>No requests yet</strong>
        <p>Submit a project brief above and your request will appear here with live status updates.</p>
      </div>
    `
  }

  return `
    <div class="request-grid">
      ${requests
        .map(
          (request) => `
            <article class="request-status-card" data-status="${escapeHtml(request.portalStatus)}" data-can-open="${request.portalStatus === 'published' && request.proposalId ? 'true' : 'false'}">
              <header>
                <div class="request-title-row">
                  <strong>${escapeHtml(request.projectName)}</strong>
                  <div class="status-pills">
                    <span class="pill ${escapeHtml(request.portalStatus)}">${statusIcon(request.portalStatus)} ${escapeHtml(request.portalStatusLabel)}</span>
                  </div>
                </div>
              </header>
              <p class="request-outcome">${escapeHtml(request.requestedOutcome)}</p>
              <footer class="request-footer">
                <span class="tiny">${ICONS.clock} ${escapeHtml(formatRelativeTime(request.createdAt))}</span>
                ${request.portalStatus === 'published' && request.proposalId
                  ? `<a
                      class="button-link button-primary button-sm"
                      href="${escapeHtml(proposalHref(request.proposalId))}"
                      data-open-proposal-id="${escapeHtml(request.proposalId)}"
                    >
                      ${ICONS.document} View proposal
                    </a>`
                  : ''}
              </footer>
            </article>
          `,
        )
        .join('')}
    </div>
  `
}

function renderProposals(proposals) {
  if (!proposals.length) {
    return `
      <div class="empty-state">
        <div class="empty-icon">${ICONS.check}</div>
        <strong>No published proposals yet</strong>
        <p>Approved proposals will appear here once a reviewer signs off in the WordClaw approval queue.</p>
      </div>
    `
  }

  return `
    <div class="proposal-grid">
      ${proposals
        .map(
          (proposal) => `
            <article class="proposal-card" data-active="${state.selectedProposalId === proposal.id ? 'true' : 'false'}">
              <header>
                <span class="pill published">${ICONS.check} Published</span>
                <h3>${escapeHtml(proposal.data.title)}</h3>
                <p class="proposal-meta-line">${escapeHtml(proposal.data.companyName)} · ${escapeHtml(proposal.data.budgetRange)} · ${escapeHtml(proposal.data.timeline)}</p>
              </header>
              <p class="proposal-summary">${escapeHtml(proposal.data.executiveSummary || 'Open the full proposal to read the generated delivery narrative.')}</p>
              <footer class="proposal-footer">
                <span class="tiny">${ICONS.clock} ${escapeHtml(formatRelativeTime(proposal.updatedAt || proposal.createdAt))}</span>
                <a
                  class="button-link ${state.selectedProposalId === proposal.id ? 'button-primary' : 'button-secondary'} button-sm"
                  href="${escapeHtml(proposalHref(proposal.id))}"
                  data-open-proposal-id="${escapeHtml(proposal.id)}"
                >
                  ${state.selectedProposalId === proposal.id ? `${ICONS.check} Reading` : `${ICONS.arrow} Read proposal`}
                </a>
              </footer>
            </article>
          `,
        )
        .join('')}
    </div>
  `
}

function renderProposalReader(proposal) {
  if (!proposal) {
    return ''
  }

  return `
    <section class="section proposal-reader" id="proposal-reader">
      <div class="proposal-reader-head">
        <div class="proposal-reader-copy">
          <span class="eyebrow">${ICONS.document} Published Proposal</span>
          <h2>${escapeHtml(proposal.data.title)}</h2>
          <p>${escapeHtml(proposal.data.projectName)} for ${escapeHtml(proposal.data.companyName)}.</p>
        </div>
        <div class="proposal-reader-meta">
          <article>
            <strong>Budget</strong>
            <span>${escapeHtml(proposal.data.budgetRange || 'Not specified')}</span>
          </article>
          <article>
            <strong>Timeline</strong>
            <span>${escapeHtml(proposal.data.timeline || 'Not specified')}</span>
          </article>
          <article>
            <strong>Published</strong>
            <span>${escapeHtml(formatDateTime(proposal.updatedAt || proposal.createdAt))}</span>
          </article>
        </div>
      </div>
      <div class="proposal-reader-lede">
        <strong>Executive summary</strong>
        <div class="proposal-rich-copy">
          ${formatRichText(proposal.data.executiveSummary || 'No executive summary was generated for this proposal.')}
        </div>
      </div>
      <div class="proposal-section-list proposal-section-list--reader">
        ${visibleProposalSections({
          ...proposal,
          data: {
            ...proposal.data,
            executiveSummary: '',
          },
        })}
      </div>
    </section>
  `
}

function renderDashboard() {
  const { user } = state.session
  const dashboard = state.dashboard || { requests: [], proposals: [] }
  const draft = state.requestDraft || createRequestDraft(user)
  const selectedProposal = dashboard.proposals.find((proposal) => proposal.id === state.selectedProposalId) ?? null

  const initials = user.fullName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return `
    <section class="account-banner">
      <div class="account-identity">
        <div class="avatar">${initials}</div>
        <div>
          <h2>${escapeHtml(user.fullName)}</h2>
          <p>${escapeHtml(user.companyName)} · ${escapeHtml(user.email)}</p>
        </div>
      </div>
      <div class="inline-actions">
        <button class="button-secondary button-sm" id="refresh-dashboard" type="button">${ICONS.refresh} Refresh</button>
        <button class="button-ghost button-sm" id="logout-button" type="button">${ICONS.logout} Sign out</button>
      </div>
    </section>

    <article class="request-card">
      <div class="request-card-header">
        <div>
          <h2>${ICONS.send} Submit a brief</h2>
          <p>Describe your project and we'll generate a proposal for human review.</p>
        </div>
      </div>
      ${renderFlash(state.requestFlash)}
      <form id="request-form">
        <div class="field-grid">
          <label>
            <span>Project name</span>
            <input name="projectName" value="${escapeHtml(draft.projectName)}" placeholder="e.g. Website Redesign" required />
          </label>
          <label>
            <span>Budget range</span>
            <input name="budgetRange" value="${escapeHtml(draft.budgetRange)}" placeholder="e.g. EUR 20k – 35k" required />
          </label>
          <label>
            <span>Company</span>
            <input name="companyName" value="${escapeHtml(draft.companyName)}" required />
          </label>
          <label>
            <span>Target timeline</span>
            <input name="targetTimeline" value="${escapeHtml(draft.targetTimeline)}" placeholder="e.g. 8 weeks" required />
          </label>
          <label class="wide">
            <span>What outcome do you need?</span>
            <textarea name="requestedOutcome" required placeholder="What should the proposal cover? What's the end goal?">${escapeHtml(draft.requestedOutcome)}</textarea>
          </label>
          <label class="wide">
            <span>Current situation</span>
            <textarea name="currentSituation" required placeholder="What problem are you solving? What exists today?">${escapeHtml(draft.currentSituation)}</textarea>
          </label>
          <label class="wide">
            <span>Key requirements</span>
            <textarea name="keyRequirements" required placeholder="Scope, integrations, quality expectations, delivery constraints.">${escapeHtml(draft.keyRequirements)}</textarea>
          </label>
          <label class="wide">
            <span>Constraints <em class="optional-label">(optional)</em></span>
            <textarea name="constraints" placeholder="Compliance, existing stack, approval constraints.">${escapeHtml(draft.constraints)}</textarea>
          </label>
        </div>
        <div class="form-actions">
          <button class="button-primary" type="submit">${ICONS.send} Submit brief</button>
          <span class="tiny">A draft will be generated and queued for human review.</span>
        </div>
      </form>
    </article>

    <div class="dashboard-columns">
      <section class="section">
        <h2>${ICONS.clock} Request status</h2>
        <p>Track your briefs through drafting, review, and publication.</p>
        ${renderRequests(dashboard.requests)}
      </section>

      <section class="section">
        <h2>${ICONS.document} Published proposals</h2>
        <p>Approved proposals are ready for you to read.</p>
        ${renderProposals(dashboard.proposals)}
      </section>
    </div>

    ${renderProposalReader(selectedProposal)}
  `
}

function render() {
  const focusState = captureFocusState()

  if (state.loading) {
    app.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <p>Loading demo…</p>
      </div>
    `
    return
  }

  app.innerHTML = `
    <div class="dashboard">
      ${renderHero()}
      ${state.session ? renderDashboard() : renderAuth()}
    </div>
  `

  bindEvents()
  restoreFocusState(focusState)
}

function bindEvents() {
  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.authMode = button.getAttribute('data-auth-mode')
      state.flash = null
      render()
    })
  })

  document.querySelector('#register-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await authenticate('/demo-api/register', {
      fullName: form.get('fullName'),
      companyName: form.get('companyName'),
      email: form.get('email'),
      password: form.get('password'),
    })
  })

  document.querySelector('#login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await authenticate('/demo-api/login', {
      email: form.get('email'),
      password: form.get('password'),
    })
  })

  document.querySelector('#logout-button')?.addEventListener('click', async () => {
    await api('/demo-api/logout', { method: 'POST' })
    state.session = null
    state.dashboard = null
    state.selectedProposalId = null
    state.requestFlash = null
    state.flash = {
      type: 'success',
      title: 'Signed out',
      body: 'Your local client session has been cleared.',
    }
    syncSelectedProposalLocation(null)
    render()
  })

  document.querySelector('#refresh-dashboard')?.addEventListener('click', async () => {
    await loadDashboard()
  })

  document.querySelector('#request-form')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)

    try {
      const payload = {
        projectName: form.get('projectName'),
        budgetRange: form.get('budgetRange'),
        requestedOutcome: form.get('requestedOutcome'),
        currentSituation: form.get('currentSituation'),
        keyRequirements: form.get('keyRequirements'),
        constraints: form.get('constraints'),
        companyName: form.get('companyName'),
        targetTimeline: form.get('targetTimeline'),
      }

      const response = await api('/demo-api/request-proposal', {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      state.requestFlash = {
        type: 'success',
        title: 'Brief submitted',
        body: `Your project brief has been received. Draft generation is in progress — check the status below.`,
      }
      state.requestDraft = createRequestDraft(state.session?.user)
      await loadDashboard()
    } catch (error) {
      state.requestFlash = {
        type: 'error',
        title: 'Submission failed',
        body: error instanceof Error ? error.message : String(error),
      }
      render()
    }
  })

  document.querySelector('#request-form')?.addEventListener('input', (event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return
    }

    if (!target.name) {
      return
    }

    state.requestDraft = {
      ...(state.requestDraft || createRequestDraft(state.session?.user)),
      [target.name]: target.value,
    }
  })

  document.querySelectorAll('[data-open-proposal-id]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      const proposalId = Number(link.getAttribute('data-open-proposal-id'))
      setSelectedProposal(proposalId)
    })
  })
}

async function authenticate(path, payload) {
  try {
    state.flash = null
    render()
    await api(path, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    await loadSessionAndDashboard()
    state.flash = null
  } catch (error) {
    state.flash = {
      type: 'error',
      title: 'Authentication failed',
      body: error instanceof Error ? error.message : String(error),
    }
    render()
  }
}

async function loadBootstrap() {
  state.bootstrap = await api('/demo-api/bootstrap')
}

async function loadSessionAndDashboard() {
  const sessionPayload = await api('/demo-api/session')
  state.session = sessionPayload.session
  if (state.session) {
    state.requestDraft = state.requestDraft || createRequestDraft(state.session.user)
    await loadDashboard()
  } else {
    state.dashboard = null
    state.requestDraft = null
    render()
  }
}

async function loadDashboard() {
  const payload = await api('/demo-api/dashboard')
  state.dashboard = payload
  const availableProposalIds = new Set((payload.proposals || []).map((proposal) => proposal.id))
  const requestedProposalId = readSelectedProposalIdFromLocation()

  if (requestedProposalId && availableProposalIds.has(requestedProposalId)) {
    state.selectedProposalId = requestedProposalId
  } else if (state.selectedProposalId && availableProposalIds.has(state.selectedProposalId)) {
    state.selectedProposalId = state.selectedProposalId
  } else {
    state.selectedProposalId = null
  }

  syncSelectedProposalLocation(state.selectedProposalId)
  render()
}

async function init() {
  try {
    await loadBootstrap()
    await loadSessionAndDashboard()
  } catch (error) {
    state.flash = {
      type: 'error',
      title: 'Demo bootstrap failed',
      body: error instanceof Error ? error.message : String(error),
    }
  } finally {
    state.loading = false
    render()
  }
}

setInterval(() => {
  if (state.session) {
    loadDashboard().catch(() => undefined)
  }
}, 12000)

init()
