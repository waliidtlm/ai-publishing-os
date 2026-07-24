# API

Phase 0 exposes health endpoints only. All responses use JSON and disable
caching.

## Application liveness

`GET /api/health`

Success: HTTP `200`

```json
{
  "service": "dashboard",
  "status": "ok",
  "timestamp": "2026-07-23T20:00:00.000Z"
}
```

This endpoint proves the Next.js process can serve requests. It does not query
PostgreSQL.

## Database readiness

`GET /api/health/database`

Success: HTTP `200`

```json
{
  "database": "reachable",
  "durationMs": 4,
  "service": "dashboard",
  "status": "ok",
  "timestamp": "2026-07-23T20:00:00.000Z"
}
```

Failure: HTTP `503`

```json
{
  "database": "unreachable",
  "durationMs": 1002,
  "service": "dashboard",
  "status": "unavailable",
  "timestamp": "2026-07-23T20:00:00.000Z"
}
```

The failure response deliberately omits connection strings and internal error
details. Structured server logs retain the diagnostic error with configured
redaction.

## Internal topic intake

`POST /api/internal/topic-intake` is the authenticated, idempotent topic
candidate intake endpoint. See [Topic intake](topic-intake.md) for the request,
response, n8n, rate-limit, and security contract.
