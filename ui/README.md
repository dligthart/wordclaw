# WordClaw Supervisor UI

This app is the built-in operator control plane for WordClaw. It is a SvelteKit frontend used for oversight and administration, not a full human-first CMS.

## Default Scope

The default supported supervisor workflow covers:

- dashboard
- audit logs
- content browser
- schema manager
- approval queue
- forms
- API keys and tenant agent provisioning

Experimental pages such as Agent Sandbox, Payments, and L402 Readiness remain available for exploration or module operations, but they are outside the default product path.

## Local Development

Run the backend first from the repository root:

```sh
npm run dev
```

Then start the UI in this directory:

```sh
npm run dev
```

The development server runs at `http://localhost:5173`.

## Useful Commands

```sh
# typecheck
npm run check

# production build
npm run build

# preview the built UI
npm run preview
```

## Production Serving

The UI is compiled statically and served by the Fastify backend at `/ui`.

```sh
cd ui
npm run build
```

Then start the root application and open `http://localhost:4000/ui`.

## Authentication Bootstrap

If no supervisor account exists yet, create the first one through the API:

```sh
curl -X POST http://localhost:4000/api/supervisors/setup-initial \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@wordclaw.local","password":"password123"}'
```

In production, set `SETUP_TOKEN` and pass it as `x-setup-token` for that one-time bootstrap call.

After the first platform supervisor exists, create additional platform or tenant-scoped supervisors with `POST /api/supervisors`. Platform supervisors can also remove other supervisor accounts with `DELETE /api/supervisors/:id`; the runtime blocks self-delete and protects the last remaining platform-scoped supervisor. Tenant-scoped supervisors are pinned to their assigned domain in the UI and cannot switch into other tenants by changing the `x-wordclaw-domain` header.

Platform-scoped supervisors can switch domains from the header selector. The shell resets them onto the dashboard on every switch so the next tenant workspace loads from a clean surface instead of replaying whichever heavy page was open before.

Tenant-scoped AI provisioning lives in two places today:

- `/ui/keys` for external provider credentials and reusable workforce agents
- `/ui/forms` for binding a public or authenticated intake form to a draft-generation target, field map, workflow hand-off, and either a workforce agent or direct SOUL/provider override

The current multimodal boundary is intentionally narrow: form-driven draft generation forwards image assets only. OpenAI, Claude, and Gemini can all receive supported images natively, but non-image files are not yet part of the generation prompt path.

Existing supervisors can rotate their own password through `PUT /api/supervisors/me/password`.

Invite-driven onboarding is also available now. `POST /api/supervisors/invite` issues a time-limited invite link. Tenant-scoped supervisors can only issue invites for their own domain, while platform-scoped supervisors can issue either platform or tenant invites. Invite recipients land on `/ui/invite?token=...`, set their password, and the UI starts their supervisor session immediately after `POST /api/supervisors/invite/accept` succeeds.

See `doc/tutorials/getting-started.md` for the full setup flow.
