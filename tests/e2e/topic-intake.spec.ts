import { randomBytes, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

interface DatabaseClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{
    rows: Row[];
  }>;
}

const { Client } = require("../../packages/database/node_modules/pg") as {
  Client: new (options: { connectionString: string }) => DatabaseClient;
};
const databaseUrl = process.env.DATABASE_URL;
const internalApiKey = process.env.INTERNAL_API_KEY;
const runToken = randomUUID().replaceAll("-", "");
const topicTitle = `Topic intake smoke test ${runToken}`;
const siteId = `c${randomBytes(12).toString("hex")}`;
let database: DatabaseClient | undefined;

test.describe.serial("internal topic intake API", () => {
  test.beforeAll(async () => {
    if (!databaseUrl || !internalApiKey) {
      throw new Error(
        "DATABASE_URL and INTERNAL_API_KEY are required for topic intake tests.",
      );
    }

    database = new Client({
      connectionString: databaseUrl,
    });
    await database.connect();
    await database.query(
      `INSERT INTO sites
        (id, name, domain, language, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'en', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        siteId,
        "Topic intake smoke-test site",
        `topic-intake-${runToken}.example.test`,
      ],
    );
  });

  test.afterAll(async () => {
    if (!database) {
      return;
    }

    await database.query(
      `DELETE FROM audit_logs
       WHERE entity_id IN (
         SELECT id FROM topics WHERE site_id = $1
         UNION
         SELECT topic_evidence.id
         FROM topic_evidence
         JOIN topics ON topics.id = topic_evidence.topic_id
         WHERE topics.site_id = $1
       )`,
      [siteId],
    );
    await database.query(
      "DELETE FROM intake_idempotency_records WHERE scope = $1",
      [`topic-intake:${siteId}:internal-api`],
    );
    await database.query("DELETE FROM sites WHERE id = $1", [siteId]);
    await database.end();
  });

  test("returns the same safe 401 response for missing and invalid keys", async ({
    request,
  }) => {
    const payload = {
      idempotencyKey: `${runToken}-unauthorized`,
      siteId,
      title: topicTitle,
    };
    const missing = await request.post("/api/internal/topic-intake", {
      data: payload,
    });
    const invalid = await request.post("/api/internal/topic-intake", {
      data: payload,
      headers: {
        "X-API-Key": "invalid-key",
      },
    });

    expect(missing.status()).toBe(401);
    expect(invalid.status()).toBe(401);
    expect(await invalid.json()).toEqual(await missing.json());
  });

  test("creates, matches, replays, and conflicts safely", async ({
    request,
  }) => {
    const headers = {
      "X-API-Key": internalApiKey!,
    };
    const payload = {
      description: "Created by the Playwright endpoint smoke test",
      idempotencyKey: `${runToken}-create`,
      siteId,
      source: {
        evidenceType: "manual",
        sourceTitle: "n8n documentation",
        sourceUrl: "https://docs.n8n.io/",
      },
      title: topicTitle,
    };
    const created = await request.post("/api/internal/topic-intake", {
      data: payload,
      headers,
    });
    const createdBody = await created.json();

    expect(created.status()).toBe(201);
    expect(createdBody).toMatchObject({
      data: {
        evidenceCreated: true,
        idempotentReplay: false,
        topicCreated: true,
      },
      success: true,
    });

    const replay = await request.post("/api/internal/topic-intake", {
      data: payload,
      headers,
    });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({
      data: {
        evidenceId: createdBody.data.evidenceId,
        idempotentReplay: true,
        topicId: createdBody.data.topicId,
      },
    });

    const conflict = await request.post("/api/internal/topic-intake", {
      data: {
        ...payload,
        title: `${topicTitle} changed`,
      },
      headers,
    });
    expect(conflict.status()).toBe(409);

    const matched = await request.post("/api/internal/topic-intake", {
      data: {
        ...payload,
        idempotencyKey: `${runToken}-match`,
        source: undefined,
        title: `  ${topicTitle.toUpperCase()}?  `,
      },
      headers,
    });
    expect(matched.status()).toBe(200);
    expect(await matched.json()).toMatchObject({
      data: {
        matchedExistingTopic: true,
        topicCreated: false,
        topicId: createdBody.data.topicId,
      },
    });
  });

  test("rejects an invalid payload without accepting status injection", async ({
    request,
  }) => {
    const response = await request.post("/api/internal/topic-intake", {
      data: {
        idempotencyKey: `${runToken}-invalid`,
        siteId,
        status: "published",
        title: topicTitle,
      },
      headers: {
        "X-API-Key": internalApiKey!,
      },
    });

    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: "validation_error",
      },
      success: false,
    });
  });

  test("shows the API-created topic and evidence in the dashboard", async ({
    page,
  }) => {
    const email = process.env.DEV_AUTH_EMAIL;
    const password = process.env.DEV_AUTH_PASSWORD;

    if (!email || !password) {
      throw new Error(
        "DEV_AUTH_EMAIL and DEV_AUTH_PASSWORD are required for dashboard verification.",
      );
    }

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in to development" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", {
        name: topicTitle,
      }),
    ).toBeVisible();
    await expect(page.getByText("n8n documentation")).toBeVisible();
  });
});
