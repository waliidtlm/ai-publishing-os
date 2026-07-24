# RSS collector

## Purpose and boundary

Phase 2 collects configured RSS 2.0 and Atom entries. n8n orchestrates work,
while the application owns the security-sensitive outbound request and XML
parser. Every eligible entry is submitted to the existing Topic Intake API.

The RSS routes never create topics or evidence. They do not score, summarize,
research, draft, scrape webpages, or publish content.

```text
active SourceConfig
  -> n8n starts a collection run
  -> application validates, fetches, and parses the configured feed
  -> n8n maps each returned entry to Topic Intake
  -> Topic Intake creates or matches topics and evidence
  -> n8n records final per-source counts
  -> dashboard shows safe status
```

## Source configuration

Use one `SourceConfig` with:

- `sourceType = RSS`;
- `collectionMethod = RSS`;
- `baseUrl` containing the RSS or Atom URL;
- `isActive = true`;
- `siteId` identifying the destination site;
- optional `collectionLimit` from 1 through 100;
- optional `metadata` for non-secret collection metadata.

`baseUrl` is the established source URL field, so Phase 2 does not add a
duplicate `feedUrl`. `collectionLimit` is capped again by the server default.
Use Prisma Studio or existing database tooling to create source configurations;
Phase 2 deliberately does not add a public feed-management API.

Per-source status fields store the latest attempt, latest successful attempt,
latest safe error, ETag, and Last-Modified value. `RssCollectionRun` stores
bounded counts and history without feed bodies.

## Internal endpoints

All routes use the Phase 1 internal authentication boundary, structured logs,
PostgreSQL rate limiting, `Cache-Control: no-store`, and `X-Request-Id`.

### List active sources

```text
GET /api/internal/sources/rss?limit=25
```

The response contains only active configurations whose source type and
collection method are RSS. It returns source/site IDs, display names, feed URL,
limit, cache validators, and safe status fields. Arbitrary metadata and secret
fields are not returned. The caller can lower the maximum but cannot exceed
`RSS_MAX_SOURCES_PER_RUN`.

### Fetch and parse one configured feed

```text
POST /api/internal/sources/:sourceId/fetch
Content-Type: application/json

{
  "entryLimit": 10
}
```

The body is optional. `entryLimit` may only lower the configured/server limit.
The caller cannot submit or override a URL. The route loads `baseUrl` from
PostgreSQL and verifies that the source exists, is active, and is RSS.

Success returns:

```json
{
  "success": true,
  "data": {
    "sourceId": "SOURCE_ID",
    "status": "fetched",
    "feedTitle": "Example feed",
    "entries": [
      {
        "stableId": "rss_SHA256",
        "title": "Example entry",
        "url": "https://example.com/article",
        "description": "Sanitized plain text",
        "excerpt": "Short sanitized plain text",
        "author": "Optional author",
        "publishedAt": "2026-07-24T10:00:00.000Z",
        "updatedAt": null,
        "feedEntryId": "optional original GUID or Atom ID",
        "metadata": {}
      }
    ],
    "discoveredCount": 20,
    "returnedCount": 10,
    "skippedCount": 10,
    "etag": "\"version-1\"",
    "lastModified": "Fri, 24 Jul 2026 10:00:00 GMT",
    "httpStatus": 200,
    "notModified": false
  }
}
```

An upstream `304` is returned as HTTP `200` with `status: "not_modified"`,
`notModified: true`, empty entries, and `httpStatus: 304`. n8n performs no
Topic Intake calls for that source.

### Record collection results

Start a run:

```text
POST /api/internal/sources/:sourceId/collection-result

{
  "status": "started",
  "workflowExecutionId": "optional-n8n-execution-id"
}
```

The response returns `runId`. When n8n finishes, it sends that ID with status
`succeeded`, `partial`, `failed`, or `not_modified`, non-negative counts,
duration, HTTP status, cache validators, and an optional safe error code and
summary.

The endpoint sanitizes and truncates error summaries to 500 characters. It
does not store authorization headers, keys, response bodies, feed XML, or n8n
stack traces. Completion updates the run and source in one transaction and
writes one source-level audit event.

## Authentication and n8n setup

The application reads `INTERNAL_API_KEY`. For curl, send it in `X-API-Key`.

The n8n export uses a generic HTTP Header Auth credential placeholder:

1. In n8n, create **Header Auth** credentials.
2. Name it `AI Publishing OS Internal API`.
3. Set header name to `X-API-Key`.
4. Set its value to the same secret as `INTERNAL_API_KEY`.
5. Select it on the six HTTP Request nodes after import.

Set this n8n environment variable:

```text
AI_PUBLISHING_OS_BASE_URL=http://dashboard:3000
```

Use `http://localhost:3000` only when n8n runs directly on the host. No API key
is stored in the workflow JSON or a Set/Code node.

Application environment:

```text
RSS_MAX_SOURCES_PER_RUN=25
RSS_MAX_ENTRIES_PER_SOURCE=20
RSS_REQUEST_TIMEOUT_MS=10000
RSS_MAX_RESPONSE_BYTES=1048576
RSS_MAX_REDIRECTS=3
```

These are server controls. n8n does not override timeout, response-size,
redirect, or URL-security policy.

## Import, manual execution, and scheduling

Import `workflows/n8n/rss-collector.json`. The workflow is inactive by default,
so the schedule cannot run immediately after import.

1. Configure `AI_PUBLISHING_OS_BASE_URL`.
2. Assign the Header Auth credential to each HTTP Request node.
3. Ensure at least one active RSS `SourceConfig` exists.
4. Click **Test workflow** using **Manual Test Trigger**.
5. Inspect **Show Run Summary**, then verify the dashboard and collection run.
6. Only after a successful manual test, activate the workflow to enable the
   six-hour schedule.

Change the Schedule Trigger interval in n8n when needed. Ensure the interval is
longer than the worst-case run. n8n does not automatically catch up schedules
missed during downtime, and Phase 2 does not add a distributed execution lock.
Deterministic Topic Intake keys protect topics/evidence during overlapping
runs, but duplicate feed fetch work is still possible.

## Workflow nodes

1. **Manual Test Trigger** starts a user-controlled test.
2. **Every 6 Hours** is the production schedule; it runs only after activation.
3. **Load Active RSS Sources** calls the secured source-list route.
4. **Split Active Sources** turns the response array into source items.
5. **Record Collection Start** creates one durable run per source.
6. **Attach Run Context** retains source and run IDs.
7. **Collection Start Recorded?** prevents fetches when a run cannot be opened.
8. **Fetch Parsed Feed** calls the secure application fetch route.
9. **Attach Fetch Context** keeps fetch responses linked to their source.
10. **Prepare Source Work** emits entry, unchanged, empty, or failed outcomes.
11. **Eligible Entry?** sends only returned entries to Topic Intake.
12. **Build Topic Intake Payload** performs the single clear intake mapping.
13. **Submit Topic Intake** calls the existing Phase 1 API.
14. **Temporary Intake Failure?** selects only 429/502/503/504 responses.
15. **Retry Delay** waits two seconds before one bounded intake retry.
16. **Retry Temporary Intake** repeats the same deterministic request once.
17. **Merge Intake Attempts** rejoins first-attempt and retry results.
18. **Attach Intake Context** restores source/entry context after HTTP calls.
19. **Normalize Intake Outcome** converts the response to counted fields.
20. **Normalize Source Outcome** handles unchanged, empty, or fetch-failed feeds.
21. **Merge Source Outcomes** combines entry and source-level outcomes.
22. **Aggregate Collection Results** groups counts and status by source.
23. **Record Final Collection Result** persists each source result.
24. **Report Unrecorded Start Failure** exposes starts that could not be stored.
25. **Merge Completed Sources** combines recorded and unrecorded source results.
26. **Show Run Summary** produces the readable final execution result.
27. **Setup** sticky note explains environment and credentials.
28. **Security boundary** sticky note explains application-side protections.
29. **Failure behavior** sticky note explains retry and continuation behavior.

The Code nodes only reshape or aggregate trusted application responses. They
perform no network requests, XML parsing, URL validation, or Topic Intake
business logic.

## Mapping and idempotency

Entry identity is selected in this order:

1. RSS GUID or Atom ID;
2. normalized canonical entry URL;
3. deterministic hash input from title, date, and sanitized description.

The chosen identity is SHA-256 hashed as `rss_<hash>`. n8n submits:

```text
rss:<sourceConfigId>:<stableId>
```

as the Topic Intake idempotency key and sends the stable ID as `externalId`.
The result is below the Phase 1 200-character key limit. Repeated requests
replay safely. Different entries with the same normalized title match the
existing site-scoped topic while their distinct source identities can create
distinct evidence.

Titles are trimmed, converted to plain text, and safely truncated to the
200-character intake limit. Entries without a usable title or HTTP(S) URL are
skipped. Publication dates are optional; invalid values become `null`.
Collection time is used only for `collectedAt`.

## Limits and first-run behavior

Defaults:

- 25 sources per run;
- 20 returned entries per source;
- 100 maximum configured entries per source;
- 500 maximum entry elements scanned from one bounded feed document;
- 1 MiB maximum decoded response body;
- 10-second upstream timeout per attempt;
- 3 redirects;
- 3 total upstream attempts for temporary network/429/502/503/504 failures.

The parser sorts scanned valid entries newest first where dates exist, returns
only the effective limit, and never imports unlimited history. A future
backfill should be a separate, explicitly bounded workflow with its own date
window and operator approval.

## HTTP caching

ETag and Last-Modified values are stored only after n8n records the final
result. The next fetch sends `If-None-Match` and `If-Modified-Since`. Redirect
targets are revalidated before the request continues. A `304` creates a
`not_modified` run, updates the successful-collection timestamp, and makes no
intake calls.

## SSRF and XML safety

The application:

- accepts only HTTP/HTTPS URLs without embedded credentials;
- blocks localhost-style names, loopback, private IPv4, carrier-grade NAT,
  link-local, private/link-local IPv6, multicast, and metadata destinations;
- resolves hostnames and rejects any blocked resolved address;
- uses manual redirects and repeats URL/DNS validation for every destination;
- keeps TLS certificate validation enabled;
- never sends the internal API credential to a feed host;
- limits redirects, time, response bytes, XML bytes, scanned entries, and
  output field lengths;
- rejects DTD and entity declarations before parsing;
- disables entity processing in `fast-xml-parser`;
- converts feed HTML to bounded plain text and removes scripts, forms, unsafe
  embedded blocks, comments, tags, controls, and excess whitespace.

Application-level DNS validation cannot completely eliminate DNS rebinding
between validation and socket connection. Production egress should also block
private, link-local, metadata, and internal network ranges at the container,
firewall, proxy, or cloud network layer. This is a documented residual risk,
not a claim of complete SSRF prevention.

## Retries and partial failures

The application makes up to three attempts only for timeouts, connection
failures, upstream 429, 502, 503, and 504 responses. Invalid URLs, blocked
destinations, malformed XML, oversized responses, and permanent upstream
errors are not retried.

n8n performs one delayed retry for temporary Topic Intake responses. Other
validation/authentication failures are counted without retry. A failed entry
does not prevent other entries. Fetch or start failures become source outcomes,
so other sources continue.

## Fixtures and tests

Local files:

- `fixtures/rss/sample-feed.xml`;
- `fixtures/rss/sample-atom.xml`;
- `fixtures/rss/malformed-feed.xml`.

Run unit and integration tests:

```powershell
pnpm test:unit
pnpm test:integration
```

With PostgreSQL and the dashboard running:

```powershell
pnpm test:smoke:rss
```

The smoke script creates and removes a temporary site/source. It parses local
RSS and Atom fixtures, verifies missing/invalid authentication, lists the
source, submits duplicate-title entries and idempotent replays through Topic
Intake, records success/partial/failure runs, verifies one matched topic with
two evidence rows, and verifies error redaction.

Strict SSRF controls intentionally reject localhost and private fixture
servers. Unit fetch tests inject controlled DNS/HTTP responses without changing
production policy. To execute the real n8n fetch end to end, host the fixture on
a controlled, publicly routable HTTPS endpoint and use that URL temporarily.

## Dashboard verification

Sign in and open `/dashboard`. **Configured feeds** shows source name, URL,
active state, latest run status/counts, last attempt, last success, and latest
safe error. **Recent topics** shows the topic and evidence created or matched by
Topic Intake.

## Troubleshooting and known limits

- `401`: assign the correct Header Auth credential and verify the app key.
- `404 rss_source_not_found`: verify the source ID and database.
- `422 source_not_rss`: set both source type and collection method to RSS.
- `422 inactive_rss_source`: activate the source before collection.
- `422 blocked_destination`: the feed resolves to a prohibited network.
- `413 feed_response_too_large`: use a smaller feed; raising the cap increases
  memory and parser risk.
- `422 malformed_feed`: fix the XML; DTD/entity feeds are intentionally refused.
- `503/504`: the upstream was temporary or timed out; bounded retries exhausted.
- Empty workflow: no active RSS sources were returned.

Phase 2 supports RSS 2.0 and Atom, not every historical feed dialect. It does
not fetch full article pages. Retention for collection runs and Phase 1
idempotency records should be defined before high-volume production use.
