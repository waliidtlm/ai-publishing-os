# ADR 001: pnpm monorepo

## Status

Accepted

## Context

The product will gain multiple applications and shared technical/domain
packages. They need consistent dependency versions and reviewable boundaries
without publishing private packages.

## Decision

Use pnpm workspaces with deployable applications under `apps` and reusable
packages under `packages`.

Current workspaces:

- `apps/dashboard`
- `packages/database`
- `packages/schemas`
- `packages/shared`

## Consequences

- One lockfile controls compatible dependency versions.
- Shared code has explicit package boundaries.
- Root commands can coordinate generation, checks, and tests.
- Workspace packages must avoid circular dependencies.
- Docker builds must copy all workspace manifests before installation.
