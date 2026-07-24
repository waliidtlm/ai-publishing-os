import { randomBytes, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

interface DatabaseClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const { Client } = require("../../packages/database/node_modules/pg") as {
  Client: new (options: { connectionString: string }) => DatabaseClient;
};
const databaseUrl = process.env.DATABASE_URL;
const internalApiKey = process.env.INTERNAL_API_KEY;
const runToken = randomUUID().replaceAll("-", "");
const siteId = `c${randomBytes(12).toString("hex")}`;
const sourceId = `c${randomBytes(12).toString("hex")}`;
const sourceName = `RSS Playwright source ${runToken}`;
let database: DatabaseClient | undefined;

test.describe.serial("internal RSS collector API", () => {
  test.beforeAll(async () => {
    if (!databaseUrl || !internalApiKey) {
      throw new Error(
        "DATABASE_URL and INTERNAL_API_KEY are required for RSS tests.",
      );
    }

    database = new Client({ connectionString: databaseUrl });
    await database.connect();
    await database.query(
      `INSERT INTO sites
        (id, name, domain, language, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'en', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [siteId, "RSS Playwright site", `rss-${runToken}.example.test`],
    );
    await database.query(
      `INSERT INTO source_configs
        (id, site_id, name, source_type, base_url, collection_method,
         trust_level, collection_frequency, is_active, collection_limit,
         created_at, updated_at)
       VALUES ($1, $2, $3, 'rss', 'http://127.0.0.1:3000/feed.xml', 'rss',
         'medium', 'manual', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [sourceId, siteId, sourceName],
    );
  });

  test.afterAll(async () => {
    if (!database) return;

    await database.query(
      "DELETE FROM audit_logs WHERE entity_type = 'source_config' AND entity_id = $1",
      [sourceId],
    );
    await database.query("DELETE FROM sites WHERE id = $1", [siteId]);
    await database.end();
  });

  test("requires internal authentication and lists only active RSS sources", async ({
    request,
  }) => {
    const missing = await request.get("/api/internal/sources/rss");
    const invalid = await request.get("/api/internal/sources/rss", {
      headers: { "X-API-Key": "invalid-key" },
    });
    const valid = await request.get("/api/internal/sources/rss", {
      headers: { "X-API-Key": internalApiKey! },
    });

    expect(missing.status()).toBe(401);
    expect(invalid.status()).toBe(401);
    expect(valid.status()).toBe(200);
    expect(await valid.json()).toMatchObject({
      data: {
        sources: expect.arrayContaining([
          expect.objectContaining({
            id: sourceId,
            siteId,
          }),
        ]),
      },
      success: true,
    });
  });

  test("blocks a loopback feed destination", async ({ request }) => {
    const response = await request.post(
      `/api/internal/sources/${sourceId}/fetch`,
      {
        data: {},
        headers: { "X-API-Key": internalApiKey! },
      },
    );

    expect(response.status()).toBe(422);
    expect(await response.json()).toMatchObject({
      error: {
        code: "blocked_destination",
        retryable: false,
      },
      success: false,
    });
  });

  test("records start and success and shows status in the dashboard", async ({
    page,
    request,
  }) => {
    const headers = { "X-API-Key": internalApiKey! };
    const started = await request.post(
      `/api/internal/sources/${sourceId}/collection-result`,
      {
        data: { status: "started", workflowExecutionId: runToken },
        headers,
      },
    );
    const startedBody = await started.json();

    expect(started.status()).toBe(201);

    const completed = await request.post(
      `/api/internal/sources/${sourceId}/collection-result`,
      {
        data: {
          acceptedCount: 1,
          discoveredCount: 1,
          durationMs: 100,
          failedCount: 0,
          httpStatus: 200,
          matchedCount: 0,
          returnedCount: 1,
          runId: startedBody.data.runId,
          skippedCount: 0,
          status: "succeeded",
          submittedCount: 1,
        },
        headers,
      },
    );

    expect(completed.status()).toBe(200);

    const email = process.env.DEV_AUTH_EMAIL;
    const password = process.env.DEV_AUTH_PASSWORD;

    if (!email || !password) {
      throw new Error("Development login variables are required.");
    }

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in to development" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: sourceName })).toBeVisible();
    await expect(page.getByText("1 accepted, 0 matched")).toBeVisible();
  });
});
