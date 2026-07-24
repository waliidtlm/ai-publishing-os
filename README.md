# AI Publishing OS

Self-hosted publishing operations application. The repository provides the
Phase 0 foundation plus a secured, idempotent internal topic-intake pipeline,
an application-secured RSS/Atom source adapter, collection visibility,
PostgreSQL-backed rate limiting, and importable n8n workflows.

AI generation, webpage crawling, WordPress publishing, Search Console, Reddit,
and GitHub collectors are intentionally not implemented.

## Selected versions

- Node.js 24
- pnpm 11.9.0
- Next.js 16.2.11
- React 19.2.8
- Auth.js / NextAuth.js 4.24.15
- PostgreSQL 18.4
- Prisma 7.9.0
- Zod 4.4.3
- Pino 10.3.1
- TypeScript 5.9.3
- Vitest 4.1.10
- Playwright 1.61.1
- ESLint 9.39.5
- Prettier 3.9.6

Auth.js v4 is used because it is the stable `next-auth` release. The
credentials provider is a development-only convenience and is disabled when
Next.js runs in production mode.

## Repository structure

```text
apps/dashboard        Next.js dashboard
packages/database     Prisma schema, client, and migrations
packages/schemas      Shared Zod schemas
packages/shared       Shared structured logging
infrastructure        Docker Compose and container files
docs                  Architecture and operational documentation
tests                 Integration and browser tests
```

The workspace is ready for future `apps/worker-api`, `packages/ai`,
`packages/collectors`, and `packages/cms` additions without creating those
implementations prematurely.

## Local installation

Requirements:

- Node.js 24 or newer
- pnpm 11.9.0
- PostgreSQL 18, or Docker Desktop

Install and configure:

```powershell
pnpm install
Copy-Item .env.example apps/dashboard/.env.local
pnpm env:validate
pnpm db:generate
pnpm db:migrate:dev -- --name phase_0_foundation
pnpm dev
```

Open <http://localhost:3000/login>.

The gitignored local environment created during Phase 0 uses:

- Email: `developer@example.com`
- Password: `local-development-only-2026`

Change every sample secret before sharing the development environment.

## Docker development environment

The Compose stack starts PostgreSQL, applies committed migrations, starts the
dashboard, and checks both services.

```powershell
Copy-Item .env.example .env
pnpm docker:config
pnpm docker:up
```

Stop the stack without deleting database data:

```powershell
pnpm docker:down
```

Delete the development database volume only when a full reset is intended:

```powershell
docker compose -f infrastructure/compose.yaml down --volumes
```

## Database commands

```powershell
pnpm db:validate
pnpm db:generate
pnpm db:migrate:dev -- --name descriptive_migration_name
pnpm db:migrate:deploy
pnpm db:studio
```

`db:migrate:dev` creates migrations during development.
`db:migrate:deploy` only applies committed migrations and is the correct
startup/deployment command.

## Health endpoints

- `GET /api/health`: application liveness; does not query PostgreSQL.
- `GET /api/health/database`: readiness; verifies PostgreSQL through Prisma.

The readiness endpoint returns HTTP `503` without exposing connection details
when PostgreSQL is unavailable.

## Quality checks

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:e2e:install
pnpm test:e2e
pnpm build
```

Integration tests migrate and query `TEST_DATABASE_URL`. Never configure that
variable with a database containing valuable data.

## Authentication boundary

The credentials login is not a production security design. It has no
database-backed users, password hashes, registration, recovery, lockout, MFA,
or production identity lifecycle.

Server-side provider selection is isolated in
`apps/dashboard/lib/auth/providers/index.ts`. Before production:

1. Add and validate an OAuth provider.
2. Replace the development provider selection.
3. Define authorization and account-linking policies.
4. Add production audit events and rate limiting.
5. Rotate every development secret.

Until OAuth is configured, production mode has no login provider.

## Documentation

- [Architecture](docs/architecture.md)
- [Database](docs/database.md)
- [Security](docs/security.md)
- [API](docs/api.md)
- [Topic intake](docs/topic-intake.md)
- [RSS collector](docs/rss-collector.md)
- [Monorepo decision](docs/decisions/001-monorepo.md)
- [PostgreSQL source-of-truth decision](docs/decisions/002-postgres-source-of-truth.md)
