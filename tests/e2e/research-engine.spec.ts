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
const topicId = `c${randomBytes(12).toString("hex")}`;
const rejectedTopicId = `c${randomBytes(12).toString("hex")}`;
const evidenceId = `c${randomBytes(12).toString("hex")}`;
let database: DatabaseClient | undefined;
let researchJobId: string;
let researchSourceId: string;

test.describe.serial("research engine API and dashboard", () => {
  test.beforeAll(async () => {
    if (!databaseUrl || !internalApiKey) {
      throw new Error(
        "DATABASE_URL and INTERNAL_API_KEY are required for research tests.",
      );
    }

    database = new Client({ connectionString: databaseUrl });
    await database.connect();
    await database.query(
      `INSERT INTO sites
        (id, name, domain, language, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'en', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [siteId, "Research Playwright site", `research-${runToken}.example.test`],
    );
    await database.query(
      `INSERT INTO topics
        (id, site_id, title, normalized_title, status, priority, total_score,
         created_at, updated_at)
       VALUES
        ($1, $3, $4, $5, 'approved', 'medium', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ($2, $3, $6, $7, 'rejected', 'medium', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        topicId,
        rejectedTopicId,
        siteId,
        `Research dashboard ${runToken}`,
        `research-dashboard-${runToken}`,
        `Rejected research ${runToken}`,
        `rejected-research-${runToken}`,
      ],
    );
    await database.query(
      `INSERT INTO topic_evidence
        (id, topic_id, evidence_type, source_url, source_title, collected_at,
         created_at, updated_at)
       VALUES ($1, $2, 'source', 'http://127.0.0.1/private',
         'Untrusted <script>alert(1)</script> source', CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [evidenceId, topicId],
    );
  });

  test.afterAll(async () => {
    if (!database) return;

    await database.query(
      `DELETE FROM audit_logs
       WHERE entity_id IN (
         SELECT id FROM research_notes WHERE site_id = $1
         UNION
         SELECT id FROM research_job_sources
           WHERE research_job_id IN (SELECT id FROM research_jobs WHERE site_id = $1)
         UNION
         SELECT id FROM research_jobs WHERE site_id = $1
       )`,
      [siteId],
    );
    await database.query("DELETE FROM sites WHERE id = $1", [siteId]);
    await database.end();
  });

  test("requires authentication and rejects ineligible topics", async ({
    request,
  }) => {
    const missing = await request.post(
      `/api/internal/topics/${topicId}/research-jobs`,
      { data: { mode: "deterministic" } },
    );
    const invalid = await request.post(
      `/api/internal/topics/${topicId}/research-jobs`,
      {
        data: { mode: "deterministic" },
        headers: {
          "X-API-Key": "invalid-internal-key-that-is-long-enough",
        },
      },
    );
    const ineligible = await request.post(
      `/api/internal/topics/${rejectedTopicId}/research-jobs`,
      {
        data: { mode: "deterministic" },
        headers: { "X-API-Key": internalApiKey! },
      },
    );

    expect(missing.status()).toBe(401);
    expect(invalid.status()).toBe(401);
    expect(ineligible.status()).toBe(409);
    expect(await ineligible.json()).toMatchObject({
      error: { code: "ineligible_topic" },
      success: false,
    });
  });

  test("creates one job and rejects a duplicate active job", async ({
    request,
  }) => {
    const headers = { "X-API-Key": internalApiKey! };
    const created = await request.post(
      `/api/internal/topics/${topicId}/research-jobs`,
      {
        data: { mode: "deterministic", triggerType: "internal_api" },
        headers,
      },
    );
    const createdBody = await created.json();

    expect(created.status()).toBe(201);
    expect(createdBody).toMatchObject({
      data: {
        job: {
          mode: "deterministic",
          status: "running",
          topicId,
        },
      },
      success: true,
    });
    researchJobId = createdBody.data.job.id;

    const sourceResult = await database!.query(
      "SELECT id FROM research_job_sources WHERE research_job_id = $1",
      [researchJobId],
    );
    researchSourceId = sourceResult.rows[0]?.id as string;

    const duplicate = await request.post(
      `/api/internal/topics/${topicId}/research-jobs`,
      { data: { mode: "deterministic" }, headers },
    );

    expect(duplicate.status()).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      error: { code: "active_research_job_exists" },
    });
  });

  test("shows notes, claim provenance, and escapes unsafe source text", async ({
    page,
  }) => {
    const noteId = `c${randomBytes(12).toString("hex")}`;
    const fingerprint = randomBytes(32).toString("hex");
    const claims = JSON.stringify([
      {
        claim: "Queue workers consume pending executions.",
        collectedAt: new Date().toISOString(),
        confidence: "medium",
        evidenceId,
        sourceTitle: "Untrusted source",
        sourceUrl: "http://127.0.0.1/private",
        supportingExcerpt: "Queue workers consume pending executions.",
      },
    ]);

    await database!.query(
      `UPDATE research_job_sources
       SET status = 'succeeded', fetched_at = CURRENT_TIMESTAMP,
           content_type = 'html', content_fingerprint = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [researchSourceId, fingerprint],
    );
    await database!.query(
      `INSERT INTO research_notes
        (id, research_job_id, research_job_source_id, topic_id, site_id,
         evidence_id, note_type, mode, version, title, summary, claims,
         definitions, statistics, examples, risks, open_questions, excerpts,
         source_url, source_title, source_publisher, fetched_at,
         content_fingerprint, metadata, quality_flags, created_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, 'source_summary', 'deterministic', 1,
         'Safe research note', $7, $8::jsonb, '[]'::jsonb, '[]'::jsonb,
         '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, $9::jsonb,
         'http://127.0.0.1/private', 'Untrusted <script>alert(1)</script> source',
         'fixture.test', CURRENT_TIMESTAMP, $10,
         '{"deterministicMode":true}'::jsonb,
         '{"promptInjectionMitigated":true}'::jsonb,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        noteId,
        researchJobId,
        researchSourceId,
        topicId,
        siteId,
        evidenceId,
        "Unsafe <img src=x onerror=alert(1)> remains plain text.",
        claims,
        JSON.stringify(["Queue workers consume pending executions."]),
        fingerprint,
      ],
    );
    await database!.query(
      `UPDATE research_jobs
       SET status = 'completed', active_topic_id = NULL,
           completed_at = CURRENT_TIMESTAMP, fetched_source_count = 1,
           successful_source_count = 1, generated_note_count = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [researchJobId],
    );
    await database!.query(
      `UPDATE topics SET status = 'brief_ready', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [topicId],
    );

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
    await expect(
      page.getByRole("heading", {
        name: `Research dashboard ${runToken}`,
      }),
    ).toBeVisible();
    await expect(page.getByText("Safe research note")).toBeVisible();
    await expect(
      page.locator("blockquote").filter({
        hasText: "Queue workers consume pending executions.",
      }),
    ).toBeVisible();
    await expect(page.getByText(`Evidence: ${evidenceId}`)).toBeVisible();
    await expect(
      page.getByText("Unsafe <img src=x onerror=alert(1)> remains plain text."),
    ).toBeVisible();
    await expect(page.locator(".research-note img")).toHaveCount(0);
    await expect(page.locator(".research-note script")).toHaveCount(0);
  });
});
