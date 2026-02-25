# Drizzle Migrations Guide

This project uses **Drizzle Kit** for schema migration management.

Current config (`drizzle.config.ts`):

- `schema`: `./src/db/schema.ts`
- `out`: `./drizzle`
- `dialect`: `postgresql`
- `dbCredentials.url`: `process.env.DATABASE_URL`

## Quick Command Cheatsheet

```bash
# Apply committed SQL migrations (recommended for shared environments)
npx drizzle-kit migrate

# Generate new SQL migration files from schema changes
npx drizzle-kit generate

# Push schema directly (fast local iteration, no SQL files created)
npx drizzle-kit push
```

## Two Supported Workflows

### 1. Team / CI / Production Flow (Recommended)

Use this when schema changes should be reviewed and committed as SQL files.

1. Update schema in `src/db/schema.ts`.
2. Generate a migration:

```bash
npx drizzle-kit generate
```

3. Review generated SQL in `drizzle/*.sql` and metadata in `drizzle/meta/*`.
4. Commit schema + migration files together.
5. Apply migrations:

```bash
npx drizzle-kit migrate
```

This is the safest and most repeatable flow across machines and environments.

### 2. Local Prototyping Flow

Use this for quick experimentation when you do not need migration SQL files yet.

```bash
npx drizzle-kit push
```

`push` compares your TypeScript schema to the live database and applies the diff directly.

## Running Migrations in This Repository

1. Ensure Postgres is running:

```bash
docker compose up -d
```

2. Ensure `DATABASE_URL` is set (`.env`).
3. Apply migrations:

```bash
npx drizzle-kit migrate
```

If you changed schema and need a new migration first:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

## Migration Tracking Table

Drizzle records applied migrations in a migrations log table.

- Table name: `__drizzle_migrations` (default)
- PostgreSQL schema: configurable via `migrations` config (`drizzle` in current kit config reference)

You can inspect applied migrations with SQL:

```sql
select * from drizzle.__drizzle_migrations order by created_at desc;
```

If your environment uses `public` for the migration schema:

```sql
select * from public.__drizzle_migrations order by created_at desc;
```

If your migration schema is customized, query that schema instead.

## Rollback Strategy

Drizzle does not generate down-migrations automatically.
Use a **forward fix** migration:

1. Update schema to desired corrected state.
2. `npx drizzle-kit generate`
3. Review SQL.
4. `npx drizzle-kit migrate`

## Optional: Run Migrations from Application Code

You can run migrations using `drizzle-orm` migrator APIs if needed:

```ts
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './src/db';

await migrate(db, { migrationsFolder: './drizzle' });
```

For this project, CLI-based `drizzle-kit migrate` remains the default operational path.

## References (Official Drizzle Docs)

- https://orm.drizzle.team/docs/migrations
- https://orm.drizzle.team/docs/drizzle-kit-generate
- https://orm.drizzle.team/docs/drizzle-kit-migrate
- https://orm.drizzle.team/docs/drizzle-kit-push
- https://orm.drizzle.team/kit-docs/config-reference
