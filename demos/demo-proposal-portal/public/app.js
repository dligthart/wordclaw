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

function renderHero() {
  const bootstrap = state.bootstrap
  const reviewer = bootstrap?.reviewer ?? {}
  const providerLabel = bootstrap?.providerLabel ?? 'deterministic demo worker'
  return `
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">Proposal Intake Demo</span>
        <h1>Brief in. Draft out. Human approval before delivery.</h1>
        <p>
          This demo uses WordClaw forms, background draft generation, the approval queue,
          and published content reads to simulate a client requesting a project proposal and
          later finding the approved proposal in their account.
        </p>
        <div class="hero-meta">
          <article class="meta-card">
            <strong>Draft Engine</strong>
            <span>${escapeHtml(providerLabel)}</span>
          </article>
          <article class="meta-card">
            <strong>Portal Flow</strong>
            <span>Register, submit a brief, wait for human approval, then read the published proposal.</span>
          </article>
          <article class="meta-card">
            <strong>Reviewer Surface</strong>
            <span><a href="${escapeHtml(bootstrap?.reviewer?.loginUrl || '#')}" target="_blank" rel="noreferrer">WordClaw supervisor UI</a></span>
          </article>
        </div>
      </div>
      <aside class="review-card">
        <div>
          <strong>Local Reviewer Login</strong>
          <span>Use the seeded tenant reviewer to approve generated proposals in the WordClaw supervisor.</span>
        </div>
        <code>${escapeHtml(reviewer.email || 'reviewer@proposal-demo.local')}
${escapeHtml(reviewer.password || 'WordClawDemo!2026')}</code>
        <div class="notice-list tiny">
          <span>1. Sign in to the supervisor.</span>
          <span>2. Open the approval queue.</span>
          <span>3. Approve the generated proposal for the requester to see it here.</span>
        </div>
        <a class="button-link button-secondary" href="${escapeHtml(reviewer.approvalsUrl || '#')}" target="_blank" rel="noreferrer">Open review queue</a>
      </aside>
    </section>
  `
}

function renderFlash(flash, className = '') {
  if (!flash) {
    return `<div class="flash ${className}" data-visible="false"></div>`
  }

  return `
    <div class="flash ${className} ${flash.type}" data-visible="true">
      <strong>${escapeHtml(flash.title)}</strong>
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
          <button class="${registerActive ? 'button-primary' : 'button-secondary'} tab-button" data-auth-mode="register">Create account</button>
          <button class="${!registerActive ? 'button-primary' : 'button-secondary'} tab-button" data-auth-mode="login">Sign in</button>
        </div>
        <h2>${registerActive ? 'Start a proposal request' : 'Return to your proposal desk'}</h2>
        <p>
          Accounts are demo-local and stored in the seeded WordClaw tenant so the portal can match
          published proposals back to the requester email.
        </p>
        ${renderFlash(state.flash)}
        <form id="${registerActive ? 'register-form' : 'login-form'}">
          ${registerActive ? `
            <label>
              <span>Full name</span>
              <input name="fullName" autocomplete="name" required />
            </label>
            <label>
              <span>Company</span>
              <input name="companyName" autocomplete="organization" required />
            </label>
          ` : ''}
          <label>
            <span>Email</span>
            <input name="email" autocomplete="email" type="email" required />
          </label>
          <label>
            <span>Password</span>
            <input name="password" autocomplete="${registerActive ? 'new-password' : 'current-password'}" type="password" minlength="8" required />
          </label>
          <button class="button-primary" type="submit">${registerActive ? 'Create account and continue' : 'Sign in'}</button>
        </form>
      </article>
      <section class="section">
        <h2>What this exercises</h2>
        <div class="timeline">
          <li>
            <time>Step 1</time>
            <span>Public form submission creates a WordClaw intake content item.</span>
          </li>
          <li>
            <time>Step 2</time>
            <span>Background draft generation creates a proposal content item.</span>
          </li>
          <li>
            <time>Step 3</time>
            <span>A human reviewer approves the proposal in the WordClaw supervisor.</span>
          </li>
          <li>
            <time>Step 4</time>
            <span>The portal only exposes proposals whose latest review decision is approved.</span>
          </li>
        </div>
      </section>
    </section>
  `
}

function renderRequests(requests) {
  if (!requests.length) {
    return `
      <article class="empty-card">
        <strong>No requests yet</strong>
        <p>Submit a project brief and the portal will track drafting, review, and publication here.</p>
      </article>
    `
  }

  return `
    <div class="request-grid">
      ${requests
        .map(
          (request) => `
            <article class="request-status-card" data-can-open="${request.portalStatus === 'published' && request.proposalId ? 'true' : 'false'}">
              <header>
                <strong>${escapeHtml(request.projectName)}</strong>
                <div class="status-pills">
                  <span class="pill ${escapeHtml(request.portalStatus)}">${escapeHtml(request.portalStatusLabel)}</span>
                </div>
              </header>
              <p>${escapeHtml(request.requestedOutcome)}</p>
              <div class="tiny">Submitted ${escapeHtml(formatDateTime(request.createdAt))}</div>
              ${request.jobId ? `<div class="tiny">Draft job #${escapeHtml(request.jobId)}</div>` : ''}
              ${request.proposalId ? `<div class="tiny">Proposal item #${escapeHtml(request.proposalId)}</div>` : ''}
              ${request.portalStatus === 'published' && request.proposalId
                ? `
                  <div class="card-actions">
                    <a
                      class="button-link ${state.selectedProposalId === request.proposalId ? 'button-primary' : 'button-secondary'} proposal-open-link"
                      href="${escapeHtml(proposalHref(request.proposalId))}"
                      data-open-proposal-id="${escapeHtml(request.proposalId)}"
                    >
                      ${state.selectedProposalId === request.proposalId ? 'Reading now' : 'Open proposal'}
                    </a>
                  </div>
                `
                : ''}
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
      <article class="empty-card">
        <strong>No published proposals yet</strong>
        <p>
          Your approved proposals show up here after a reviewer signs off in the WordClaw approval queue.
        </p>
      </article>
    `
  }

  return `
    <div class="proposal-grid">
      ${proposals
        .map(
          (proposal) => `
            <article class="proposal-card" data-active="${state.selectedProposalId === proposal.id ? 'true' : 'false'}">
              <header>
                <strong>${escapeHtml(proposal.data.projectName)}</strong>
                <h3>${escapeHtml(proposal.data.title)}</h3>
                <p>${escapeHtml(proposal.data.companyName)} · ${escapeHtml(proposal.data.budgetRange)} · ${escapeHtml(proposal.data.timeline)}</p>
              </header>
              <p>${escapeHtml(proposal.data.executiveSummary || 'Open the full proposal to read the generated delivery narrative.')}</p>
              <div class="card-actions">
                <a
                  class="button-link ${state.selectedProposalId === proposal.id ? 'button-primary' : 'button-secondary'} proposal-open-link"
                  href="${escapeHtml(proposalHref(proposal.id))}"
                  data-open-proposal-id="${escapeHtml(proposal.id)}"
                >
                  ${state.selectedProposalId === proposal.id ? 'Reading now' : 'Open proposal'}
                </a>
              </div>
              <div class="tiny">Published ${escapeHtml(formatDateTime(proposal.updatedAt || proposal.createdAt))}</div>
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
          <span class="eyebrow">Published Proposal</span>
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

  return `
    <section class="account-banner">
      <div>
        <span class="eyebrow">Client workspace</span>
        <h2>${escapeHtml(user.fullName)}</h2>
        <p>${escapeHtml(user.companyName)} · ${escapeHtml(user.email)}</p>
      </div>
      <div class="inline-actions">
        <button class="button-secondary" id="refresh-dashboard" type="button">Refresh status</button>
        <button class="button-ghost" id="logout-button" type="button">Sign out</button>
      </div>
    </section>

    <section class="two-up">
      <article class="request-card">
        <h2>Request a proposal</h2>
        <p>
          Submit a structured brief. WordClaw will create the intake item, draft the proposal,
          and wait for human approval before the proposal appears in your account.
        </p>
        ${renderFlash(state.requestFlash)}
        <form id="request-form">
          <div class="field-grid">
            <label>
              <span>Project name</span>
              <input name="projectName" value="${escapeHtml(draft.projectName)}" required />
            </label>
            <label>
              <span>Budget range</span>
              <input name="budgetRange" value="${escapeHtml(draft.budgetRange)}" placeholder="EUR 20k to 35k" required />
            </label>
            <label class="wide">
              <span>Requested outcome</span>
              <textarea name="requestedOutcome" required placeholder="What do you need the proposal to cover?">${escapeHtml(draft.requestedOutcome)}</textarea>
            </label>
            <label class="wide">
              <span>Current situation</span>
              <textarea name="currentSituation" required placeholder="What problem are you trying to solve?">${escapeHtml(draft.currentSituation)}</textarea>
            </label>
            <label class="wide">
              <span>Key requirements</span>
              <textarea name="keyRequirements" required placeholder="Mention scope, integrations, delivery constraints, and quality expectations.">${escapeHtml(draft.keyRequirements)}</textarea>
            </label>
            <label class="wide">
              <span>Constraints</span>
              <textarea name="constraints" placeholder="Optional: compliance, timeline, existing stack, or approval constraints.">${escapeHtml(draft.constraints)}</textarea>
            </label>
            <label>
              <span>Company</span>
              <input name="companyName" value="${escapeHtml(draft.companyName)}" required />
            </label>
            <label>
              <span>Target timeline</span>
              <input name="targetTimeline" value="${escapeHtml(draft.targetTimeline)}" placeholder="Launch in 8 weeks" required />
            </label>
          </div>
          <button class="button-primary" type="submit">Queue proposal draft</button>
        </form>
      </article>

      <section class="section">
        <h2>Request timeline</h2>
        <p>The portal tracks each brief through drafting, review, and publication.</p>
        ${renderRequests(dashboard.requests)}
      </section>
    </section>

    <section class="section">
      <h2>Published proposals</h2>
      <p>
        Only proposals whose latest review decision is approved are shown here. Open one to read the full proposal.
      </p>
      ${renderProposals(dashboard.proposals)}
    </section>
    ${renderProposalReader(selectedProposal)}
  `
}

function render() {
  const focusState = captureFocusState()

  if (state.loading) {
    app.innerHTML = `
      ${renderHero()}
      <section class="section">
        <h2>Loading demo state</h2>
        <p>Reading the seeded demo config and your current portal session.</p>
      </section>
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
        title: 'Proposal request queued',
        body: `Intake item #${response.contentItemId} created. Draft job #${response.draftGenerationJobId} is now running.`,
      }
      state.requestDraft = createRequestDraft(state.session?.user)
      await loadDashboard()
    } catch (error) {
      state.requestFlash = {
        type: 'error',
        title: 'Request failed',
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
