# Tests

- `apps/dashboard/tests`: fast unit tests.
- `tests/integration`: tests against the real PostgreSQL test database.
- `tests/e2e`: browser flows executed with Playwright.

Integration tests require `TEST_DATABASE_URL`. The runner applies committed
migrations to that database before executing tests. Never point
`TEST_DATABASE_URL` at a database containing valuable data.
