# ADR 002: PostgreSQL as source of truth

## Status

Accepted

## Context

Publishing workflows require durable relationships, idempotency, auditability,
transactions, and queryable lifecycle state. n8n will orchestrate external
workflows but must not become the authoritative application datastore.

## Decision

Use PostgreSQL as the sole application source of truth. Use Prisma for the
schema, migrations, and typed application client.

## Consequences

- n8n and future workers call application APIs instead of owning business data.
- Lifecycle fields remain queryable typed columns.
- Database migrations are committed and applied before application startup.
- JSON fields are limited to optional metadata and audit snapshots.
- Database availability is a readiness concern, not an application-liveness
  concern.
