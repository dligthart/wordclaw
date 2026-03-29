# Demo Lightheart Site

This demo recreates the core Lightheart marketing-site patterns inside `wordclaw/demos/` so we can judge whether a site like `lightheart.tech` can sit on top of the current WordClaw runtime.

It is intentionally a standalone front-end demo instead of a full WordClaw-backed integration. The UI and content structure are based on the local source repo at `/Users/daveligthart/GitHub/lightheart-website`, but the content is condensed into local typed fixtures so the demo stays self-contained.

## What It Covers

- Lightheart-style visual language
- representative routes: `/`, `/services`, `/approach`, `/case-studies`, `/about`, `/contact`, `/wordclaw-fit`
- English and Dutch locale switching
- reused Lightheart assets and logos
- an explicit `WordClaw fit` page that documents what maps cleanly and what still needs custom work

## Run It

```bash
cd demos/demo-lightheart-site
npm install
npm run dev
```

Then open the local Vite URL.

## WordClaw Read

This demo suggests a content model like:

- `site_settings`
- `marketing_page`
- `service_offer`
- `case_study`
- `contact_request`

The current WordClaw runtime now directly covers more of this than the original demo assumed:

- singleton globals for site settings and shared CTAs
- localized fields with locale-aware reads and fallback
- assets and preview-oriented published vs working-copy reads
- reusable forms, jobs, and webhook-driven follow-up paths

The main remaining gaps are not about storing the content. They are about marketing-site authoring and delivery ergonomics:

- visual page composition / preview
- SSR or static-site delivery helpers for marketing routes
- translation management workflow
- contact-form routing and downstream delivery integrations

That means the answer is broadly: yes, a site like Lightheart can be created using WordClaw as the content runtime, but not yet as a complete marketing-site platform without custom front-end and workflow work.
