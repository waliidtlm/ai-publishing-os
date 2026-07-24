import { randomBytes, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

interface DatabaseClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

const { Client } = require("../../packages/database/node_modules/pg") as {
  Client: new (options: { connectionString: string }) => DatabaseClient;
};
const databaseUrl = process.env.DATABASE_URL;
const runToken = randomUUID().replaceAll("-", "");
const id = () => `c${randomBytes(12).toString("hex")}`;
const siteId = id();
const topicId = id();
const evidenceId = id();
const researchJobId = id();
const researchSourceId = id();
const researchNoteId = id();
const previousBriefJobId = id();
const previousBriefId = id();
const briefJobId = id();
const briefId = id();
let database: DatabaseClient | undefined;

test.describe.serial("content brief dashboard", () => {
  test.beforeAll(async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL is required.");
    database = new Client({ connectionString: databaseUrl });
    await database.connect();
    const sourceUrl = `https://brief-${runToken}.example.test/source`;
    await database.query(
      `INSERT INTO sites
        (id, name, domain, language, target_audience, status, created_at, updated_at)
       VALUES ($1, 'Brief Playwright site', $2, 'en', 'Automation engineers',
         'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [siteId, `brief-${runToken}.example.test`],
    );
    await database.query(
      `INSERT INTO topics
        (id, site_id, title, normalized_title, status, priority, total_score,
         created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'drafting', 'medium', 0,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        topicId,
        siteId,
        `Content brief dashboard ${runToken}`,
        `content-brief-dashboard-${runToken}`,
      ],
    );
    await database.query(
      `INSERT INTO topic_evidence
        (id, topic_id, evidence_type, source_url, source_title, collected_at,
         created_at, updated_at)
       VALUES ($1, $2, 'source', $3, 'Validated source',
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [evidenceId, topicId, sourceUrl],
    );
    await database.query(
      `INSERT INTO research_jobs
        (id, site_id, topic_id, status, trigger_type, mode, completed_at,
         selected_evidence_count, successful_source_count, generated_note_count,
         created_at, updated_at)
       VALUES ($1, $2, $3, 'completed', 'internal_api', 'deterministic',
         CURRENT_TIMESTAMP, 1, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [researchJobId, siteId, topicId],
    );
    await database.query(
      `INSERT INTO research_job_sources
        (id, research_job_id, evidence_id, source_url, canonical_url,
         source_title, selection_rank, status, content_fingerprint,
         created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4, 'Validated source', 0, 'succeeded', $5,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [researchSourceId, researchJobId, evidenceId, sourceUrl, "a".repeat(64)],
    );
    await database.query(
      `INSERT INTO research_notes
        (id, research_job_id, research_job_source_id, topic_id, site_id,
         evidence_id, note_type, mode, version, title, summary, claims,
         definitions, statistics, examples, risks, open_questions, excerpts,
         source_url, source_title, fetched_at, content_fingerprint,
         created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'source_summary', 'deterministic', 1,
         'Validated note', 'Grounded summary', $7::jsonb, '[]'::jsonb,
         '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, $8::jsonb,
         $9, 'Validated source', CURRENT_TIMESTAMP, $10,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        researchNoteId,
        researchJobId,
        researchSourceId,
        topicId,
        siteId,
        evidenceId,
        JSON.stringify([
          {
            claim: "Bounded retries improve reliability.",
            confidence: "high",
            evidenceId,
            sourceTitle: "Validated source",
            sourceUrl,
            supportingExcerpt: "Bounded retries improve reliability.",
          },
        ]),
        JSON.stringify(["Bounded retries improve reliability."]),
        sourceUrl,
        "a".repeat(64),
      ],
    );
    await database.query(
      `INSERT INTO brief_generation_jobs
        (id, site_id, topic_id, research_job_id, status, mode,
         prompt_template_version, input_fingerprint, research_snapshot_fingerprint,
         research_snapshot, completed_at, input_note_count, input_claim_count,
         included_source_count, generated_section_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'completed', 'deterministic', 'content-brief-v1',
         $5, $6, '{}'::jsonb, CURRENT_TIMESTAMP, 1, 1, 1, 3,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        briefJobId,
        siteId,
        topicId,
        researchJobId,
        "b".repeat(64),
        "c".repeat(64),
      ],
    );
    await database.query(
      `INSERT INTO brief_generation_jobs
        (id, site_id, topic_id, research_job_id, status, mode,
         prompt_template_version, input_fingerprint, research_snapshot_fingerprint,
         research_snapshot, completed_at, input_note_count, input_claim_count,
         included_source_count, generated_section_count, created_at, updated_at)
       SELECT $1, site_id, topic_id, research_job_id, status, mode,
         prompt_template_version, $2, research_snapshot_fingerprint,
         research_snapshot, completed_at, input_note_count, input_claim_count,
         included_source_count, generated_section_count,
         created_at - INTERVAL '1 hour', updated_at
       FROM brief_generation_jobs WHERE id = $3`,
      [previousBriefJobId, "d".repeat(64), briefJobId],
    );
    const reference = {
      evidenceId,
      noteId: researchNoteId,
      sourceTitle: "Validated <script>alert(1)</script> source",
      sourceUrl,
      supportingExcerpt: "Bounded retries improve reliability.",
    };
    const outline = [
      {
        heading: "Understand the reliability problem",
        keyPoints: ["Explain bounded retry behavior."],
        sourceReferences: [reference],
      },
      {
        heading: "Apply bounded retry controls",
        keyPoints: ["Use a fixed maximum attempt count."],
        sourceReferences: [reference],
      },
      {
        heading: "Handle caveats",
        keyPoints: ["Avoid duplicate non-idempotent writes."],
        sourceReferences: [reference],
      },
    ];
    await database.query(
      `INSERT INTO content_briefs
        (id, site_id, topic_id, current_topic_id, brief_generation_job_id,
         research_job_id, version, status, primary_title, alternative_titles,
         target_audience, intent_type, intent, angle, purpose, scope, exclusions,
         article_type, target_depth, tone, outline, key_claims, required_sources,
         questions_to_answer, definitions, examples, statistics, risks_and_caveats,
         research_gaps, internal_link_suggestions,
         external_reference_requirements, drafting_instructions,
         quality_requirements, estimated_word_count_minimum,
         estimated_word_count_maximum, research_snapshot,
         research_snapshot_fingerprint, input_fingerprint, created_at, updated_at)
       VALUES ($1, $2, $3, $3, $4, $5, 2, 'current', $6, $7::jsonb,
         $8::jsonb, 'informational', $9::jsonb, $10, $11, $12::jsonb,
         $13::jsonb, 'guide', 'comprehensive', 'clear', $14::jsonb,
         $15::jsonb, $16::jsonb, $17::jsonb, '[]'::jsonb, '[]'::jsonb,
         '[]'::jsonb, $18::jsonb, $19::jsonb, '[]'::jsonb, $20::jsonb,
         $21::jsonb, $22::jsonb, 1800, 2500, '{}'::jsonb, $23, $24,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        briefId,
        siteId,
        topicId,
        briefJobId,
        researchJobId,
        "Reliable automation: An evidence-grounded guide",
        JSON.stringify(["Reliable automation without retry guesswork"]),
        JSON.stringify({ description: "Automation engineers" }),
        JSON.stringify({ description: "Learn safe retry design" }),
        "Focus on operational reliability and bounded failure handling.",
        "Plan a grounded technical guide.",
        JSON.stringify(["Validated retry controls"]),
        JSON.stringify(["Full article prose"]),
        JSON.stringify(outline),
        JSON.stringify([
          {
            claim: "Bounded retries improve reliability.",
            researchClaimId: `${researchNoteId}:claim:0`,
            sourceReferences: [reference],
          },
        ]),
        JSON.stringify([reference]),
        JSON.stringify([
          {
            mappedSectionHeading: outline[0].heading,
            question: "Why bound retries?",
            status: "covered",
          },
        ]),
        JSON.stringify(["Retries can duplicate writes."]),
        JSON.stringify([
          {
            description: "Provider-specific limits need verification.",
            impact: "minor",
            type: "other",
          },
        ]),
        JSON.stringify([reference]),
        JSON.stringify(["Use only validated claims."]),
        JSON.stringify(["Cite every required source."]),
        "c".repeat(64),
        "b".repeat(64),
      ],
    );
    await database.query(
      `INSERT INTO content_briefs
       SELECT (
         jsonb_populate_record(
           NULL::content_briefs,
           to_jsonb(current_brief) || jsonb_build_object(
             'id', $1::text,
             'current_topic_id', NULL,
             'brief_generation_job_id', $2::text,
             'version', 1,
             'status', 'superseded',
             'primary_title', 'Previous reliable automation brief',
             'input_fingerprint', $3::text,
             'created_at', current_brief.created_at - INTERVAL '1 hour'
           )
         )
       ).*
       FROM content_briefs AS current_brief
       WHERE current_brief.id = $4`,
      [previousBriefId, previousBriefJobId, "d".repeat(64), briefId],
    );
  });

  test.afterAll(async () => {
    if (!database) return;
    await database.query("DELETE FROM content_briefs WHERE site_id = $1", [
      siteId,
    ]);
    await database.query(
      "DELETE FROM brief_generation_jobs WHERE site_id = $1",
      [siteId],
    );
    await database.query("DELETE FROM sites WHERE id = $1", [siteId]);
    await database.end();
  });

  test("shows the current brief, outline, provenance, history, and escaped text", async ({
    page,
  }) => {
    const email = process.env.DEV_AUTH_EMAIL;
    const password = process.env.DEV_AUTH_PASSWORD;
    if (!email || !password) throw new Error("Development login is required.");
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in to development" }).click();
    await expect(page).toHaveURL(/\/dashboard$/u);
    await expect(
      page.getByRole("heading", {
        name: "Reliable automation: An evidence-grounded guide",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Understand the reliability problem"),
    ).toBeVisible();
    await expect(page.getByText("version 2", { exact: false })).toBeVisible();
    await expect(
      page.getByText("Validated <script>alert(1)</script> source").first(),
    ).toBeVisible();
    await expect(page.locator(".brief-summary script")).toHaveCount(0);
    await page
      .getByText("Planning checks and version history", { exact: true })
      .click();
    await expect(
      page.getByText(/v1: Previous reliable automation brief/u),
    ).toBeVisible();
    await expect(
      page.getByText("drafting", { exact: false }).first(),
    ).toBeVisible();
  });
});
