# Topic intake

## Purpose

`POST /api/internal/topic-intake` is the secured server-to-server entry point
for topic candidates. It creates a candidate topic or matches an existing
site-scoped normalized title, optionally attaches evidence, writes audit
records, and stores the result for safe idempotent retries.

This endpoint is not an RSS collector, scraper, AI writer, research tool, or
publishing integration.

## Authentication and environment

Send the internal key in the `X-API-Key` header. The existing `Authorization:
Bearer <key>` compatibility path is also accepted. Browser sessions are not
used.

Server environment:

```text
INTERNAL_API_KEY=<at-least-32-character-secret>
INTERNAL_API_RATE_LIMIT_MAX=60
INTERNAL_API_RATE_LIMIT_WINDOW_SECONDS=60
DATABASE_URL=<PostgreSQL connection URL>
```

Never place the API key in browser code, workflow JSON, source control, URLs, or
logs.

## Request

Repository IDs are CUIDs. Use IDs returned by the existing database or
dashboard tooling; they are not UUIDs.

```json
{
  "siteId": "REPLACE_WITH_SITE_ID",
  "title": "How to prevent duplicate executions in n8n",
  "description": "A practical troubleshooting article",
  "externalId": "optional-stable-source-id",
  "idempotencyKey": "manual-test-001",
  "metadata": {
    "submittedBy": "manual-test"
  },
  "source": {
    "sourceConfigId": "OPTIONAL_SOURCE_CONFIG_ID",
    "evidenceType": "manual",
    "sourceUrl": "https://docs.n8n.io/",
    "sourceTitle": "n8n documentation",
    "excerpt": "Example evidence for testing.",
    "collectedAt": "2026-07-24T10:00:00Z",
    "metadata": {}
  }
}
```

`source` is optional. When `source` is present, `sourceUrl` is required and
must use HTTP or HTTPS. This preserves the Phase 0 evidence domain model and
its URL uniqueness constraint.

Supported evidence types are `manual`, `source`, `trend`, `keyword`,
`competitor`, and `performance`. The request is strict: unknown fields,
including status, score, priority, and publication state, are rejected.

Limits:

- title: 200 characters;
- description: 2,000 characters;
- source title: 300 characters;
- excerpt: 5,000 characters;
- URL: 2,048 characters;
- external ID: 300 characters;
- idempotency key: 200 characters;
- each metadata object: 16,384 serialized bytes.

If `sourceConfigId` is supplied, it must exist, belong to the submitted site,
and be active.

## Responses

New topic: HTTP `201`.

```json
{
  "success": true,
  "data": {
    "topicId": "TOPIC_ID",
    "topicCreated": true,
    "matchedExistingTopic": false,
    "evidenceId": "EVIDENCE_ID",
    "evidenceCreated": true,
    "idempotentReplay": false,
    "status": "candidate"
  }
}
```

Existing normalized topic or valid replay: HTTP `200`. A replay sets
`idempotentReplay` to `true`. The first response can be safely passed to later
n8n nodes using `data.topicId`, `data.evidenceId`, and the creation flags.

Validation error: HTTP `400`.

```json
{
  "success": false,
  "error": {
    "code": "validation_error",
    "message": "The request body failed validation.",
    "fields": [
      {
        "path": "source.sourceUrl",
        "message": "Must use the HTTP or HTTPS protocol"
      }
    ]
  }
}
```

Other expected codes are `401` for missing or invalid authentication, `404`
for an unknown site or source configuration, `409` for idempotency conflict,
`422` for an inactive source configuration, and `429` for rate limiting. Every
response includes `X-Request-Id`.

## Duplicate and idempotency behavior

Titles are normalized deterministically by Unicode normalization, trimming,
internal whitespace collapse, case folding, and removal of terminal `?`, `!`,
and `.` punctuation. Matching is always scoped to a site. Existing status,
score, priority, title, and description are preserved.

Evidence is deduplicated within a topic. New evidence receives a deterministic
fingerprint based on:

1. source configuration plus external ID, when both exist; otherwise
2. evidence type plus normalized source URL.

The original Phase 0 topic/URL/evidence-type unique constraint remains active.

Idempotency keys are scoped to `topic-intake`, the submitted site, and the
current internal API integration identity. The canonical validated request is
SHA-256 hashed. A matching key and hash replays the stored result without new
topics, evidence, or audit logs. Reusing the key with different data returns
HTTP `409`. Records are durable and currently retained indefinitely; define a
retention/archive policy before high-volume production use.

## Rate limiting

The default limit is 60 authenticated requests per 60-second fixed window.
Buckets are stored in PostgreSQL, so all application instances share state.
The identifier is the configured internal integration identity, not client IP.
Therefore, reverse-proxy headers are not trusted or required for the current
limit. When distinct integration keys are introduced, scope buckets by the
authenticated integration identity.

Buckets older than 24 hours are deleted during checks. A production proxy or
gateway may add a second perimeter limit, but must only trust forwarded client
addresses from explicitly trusted proxies. Missing or invalid-key requests are
rejected before a database identity is assigned, so production ingress should
rate-limit those authentication failures.

## cURL

```bash
curl -X POST http://localhost:3000/api/internal/topic-intake \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $INTERNAL_API_KEY" \
  -d '{
    "siteId": "REPLACE_WITH_SITE_ID",
    "title": "How to prevent duplicate executions in n8n",
    "description": "A practical troubleshooting article",
    "idempotencyKey": "manual-test-001",
    "source": {
      "evidenceType": "manual",
      "sourceUrl": "https://docs.n8n.io/",
      "sourceTitle": "n8n documentation",
      "excerpt": "Example evidence for testing."
    }
  }'
```

Change the idempotency key when intentionally submitting materially different
data.

With the local dashboard running, the repository also provides a repeatable
direct smoke test that creates and removes its own temporary site:

```powershell
pnpm test:smoke:topic-intake
```

## Postman

1. Create a `POST` request to
   `http://localhost:3000/api/internal/topic-intake`.
2. Add `Content-Type: application/json`.
3. Store the secret in a Postman environment variable and set
   `X-API-Key: {{INTERNAL_API_KEY}}`.
4. Paste the request example and replace the site ID.
5. Send it once for creation, repeat it for replay, then change only the body
   while retaining the key to verify HTTP `409`.

## n8n smoke test

Import `workflows/n8n/topic-intake-smoke-test.json`. Configure n8n server
environment variables:

```text
AI_PUBLISHING_OS_BASE_URL=http://dashboard:3000
AI_PUBLISHING_OS_API_KEY=<same secret as INTERNAL_API_KEY>
```

For n8n outside Compose, use the reachable dashboard URL instead. In **Set
Sample Topic**, replace `REPLACE_WITH_SITE_ID` and edit the sample title or
evidence. The timestamp expression creates a new idempotency key per manual
execution. For retry testing, replace it with a fixed value.

The nodes are Manual Trigger, Set Sample Topic, Submit Topic Intake, and Show
Intake Response. This is only a smoke-test client and has not been executed
against an n8n instance.

## Troubleshooting and security limits

- `401`: verify the server and client use the same key and header.
- `404 site_not_found`: replace the placeholder with an existing site CUID.
- `404 source_configuration_not_found`: verify ownership by the submitted site.
- `409`: use the original body or a new idempotency key.
- `422`: activate the source configuration or omit it for standalone evidence.
- `429`: wait for `Retry-After`; raising limits increases database and audit
  load.
- `500`: use `X-Request-Id` to locate the structured server log. Responses
  deliberately omit stack traces and database details.

The single shared internal key does not provide per-collector revocation or
authorization. Before multiple external collectors are trusted, introduce
separate integration identities, key rotation, and per-integration scopes.
