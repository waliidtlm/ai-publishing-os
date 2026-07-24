# Security

## Development credentials login

The credentials login is intentionally development-only. The provider is not
registered when `NODE_ENV` is anything other than `development`.

It is not production-secure because it lacks:

- database-backed identities and password hashing;
- MFA, lockout, recovery, and identity verification;
- password lifecycle and breach detection;
- production authorization and account-linking policy.

OAuth must replace it before production deployment.

## Secrets

Secrets belong in environment variables or a production secret manager.
`.env`, `.env.local`, and environment-specific local files are ignored by Git.

Required server secrets:

- `NEXTAUTH_SECRET`
- `INTERNAL_API_KEY`
- PostgreSQL credentials embedded in `DATABASE_URL`

The Compose defaults are development conveniences. They must never be reused in
a shared or production deployment.

## Internal API

The topic-intake endpoint reuses the Phase 0 server-only, timing-safe
authenticator. Internal endpoints must:

- read the key only in server code;
- use a timing-safe comparison;
- return generic authentication errors;
- apply rate limiting at the documented boundary;
- never log the key or authorization header.

`InternalApiRateLimiter` remains the required boundary. Topic intake uses a
PostgreSQL fixed-window implementation shared by every dashboard instance.
The current identity scope represents the single configured internal API key;
separate collector identities are required before granting different
permissions or independent revocation.

## Logging

Server logs are structured JSON. The logger redacts authorization headers,
cookies, passwords, secrets, tokens, and API keys.

Application responses must not expose stack traces, database URLs, keys, or
provider configuration.

## Database

The local Compose database publishes host port `5433` for development tooling
while PostgreSQL remains on container port `5432`. A
production database should use a private network, least-privilege application
role, encrypted connections, backups, monitoring, and credential rotation.

## Remaining production work

- OAuth provider and authorization model.
- Rate limiting for authentication and internal APIs.
- Production secret management and rotation.
- Security headers and deployment-specific proxy controls.
- Audit events for identity and privileged actions.
- Backup, restore, and incident-response procedures.
