# Database

## Platform

PostgreSQL 18 is the source of truth. Prisma 7 provides the schema, migration
workflow, and typed client. Runtime connections use the Prisma PostgreSQL
driver adapter.

## Models

- `User`: future application identity reference and audit-log actor.
- `Site`: normalized publishing property identified by unique domain.
- `SourceConfig`: collection configuration belonging to a site.
- `Topic`: site-scoped content opportunity with a unique normalized title.
- `TopicEvidence`: source evidence with a site/topic idempotency constraint.
- `TopicScore`: immutable score history for a topic.
- `AuditLog`: mutation history with optional user attribution.
- `IntakeIdempotencyRecord`: site-scoped request hash and stored intake result.
- `InternalApiRateLimitBucket`: shared fixed-window internal API counters.
- `RssCollectionRun`: bounded per-source RSS collection history and counts.

The database stores operational fields in typed columns. JSON is reserved for
optional metadata and before/after audit snapshots.

## Important constraints

- User email is unique.
- Site domain is unique.
- Topic normalized title is unique within a site.
- Source configuration name is unique within a site.
- Topic evidence is unique by topic, source URL, and evidence type.
- New intake evidence also has a topic-scoped deterministic fingerprint.
- Intake idempotency keys are unique within their site/integration scope.
- Rate-limit buckets are unique by scope, identifier, and time window.
- RSS source collection limits are null or between 1 and 100.
- RSS run counts and durations are non-negative.
- Site-owned records cascade on site/topic deletion.
- Audit-log users and evidence source configurations become null when the
  referenced optional record is deleted.

Indexes cover topic filtering, score ordering, evidence timelines, collection
scheduling, and audit lookup patterns.

## Migration workflow

Create a migration:

```powershell
pnpm db:migrate:dev -- --name descriptive_name
```

Apply committed migrations:

```powershell
pnpm db:migrate:deploy
```

Validate and regenerate:

```powershell
pnpm db:validate
pnpm db:generate
```

Do not edit an applied migration. Create a new migration for schema changes.

## Test database

`TEST_DATABASE_URL` must identify a disposable PostgreSQL database. The
integration-test runner applies all committed migrations before querying it.
Never reuse a production or valuable development database as the test database.
