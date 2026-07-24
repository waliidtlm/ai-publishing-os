# Architecture

## Current scope

Phase 0 establishes the runtime and repository boundaries. Phase 1 adds one
secured topic-intake API and a smoke-test n8n client. It does not implement
content collection, AI generation, WordPress publishing, analytics, or an n8n
collector.

## Components

### Dashboard

`apps/dashboard` is a Next.js App Router application. It owns browser-facing
pages, Auth.js route handling, health endpoints, and server-only integration
with shared packages.

### Database

`packages/database` owns the Prisma schema, generated client boundary,
connection factory, migrations, and database connectivity check. PostgreSQL is
the application source of truth.

The Prisma client is created lazily. This keeps static builds independent of a
running database while ensuring runtime database operations fail clearly when
`DATABASE_URL` is missing.

### Schemas

`packages/schemas` owns reusable Zod schemas. Phase 0 uses it for authentication,
database, internal API, and logging environment validation.

### Shared

`packages/shared` contains infrastructure-neutral shared code. It provides a
Pino JSON logger with credential, cookie, token, and authorization-header
redaction plus deterministic topic normalization, canonical hashing, and
evidence fingerprint utilities.

### Infrastructure

`infrastructure/compose.yaml` runs PostgreSQL and the dashboard. PostgreSQL must
be healthy before the dashboard applies migrations and starts.

## Dependency direction

```text
dashboard -> database
dashboard -> schemas
dashboard -> shared
database  -> Prisma + PostgreSQL adapter
schemas   -> Zod
shared    -> Pino
```

Shared packages do not import the dashboard. The database package does not
import application UI or feature logic.

## Future boundaries

- `apps/worker-api`: background/internal service entrypoint.
- `packages/ai`: model-provider abstractions and generation logic.
- `packages/collectors`: evidence collection adapters.
- `packages/cms`: CMS publishing integrations.

These boundaries are reserved but intentionally absent until their features are
approved.
