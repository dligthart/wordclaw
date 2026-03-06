# WordClaw Supervisor UI

This app is the built-in operator control plane for WordClaw. It is a SvelteKit frontend used for oversight and administration, not a full human-first CMS.

## Default Scope

The default supported supervisor workflow covers:

- dashboard
- audit logs
- content browser
- schema manager
- approval queue
- API keys

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

See `doc/tutorials/getting-started.md` for the full setup flow.
