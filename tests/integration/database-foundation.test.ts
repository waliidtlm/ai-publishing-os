import { getDatabaseClient } from "@ai-publishing-os/database";
import { afterAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseSuite = testDatabaseUrl ? describe : describe.skip;
const database = testDatabaseUrl
  ? getDatabaseClient(testDatabaseUrl)
  : undefined;

function requireDatabase() {
  if (!database) {
    throw new Error("TEST_DATABASE_URL is required for database tests.");
  }

  return database;
}

databaseSuite("PostgreSQL foundation", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("accepts a query through Prisma", async () => {
    const result = await requireDatabase().$queryRaw<Array<{ value: number }>>`
      SELECT 1::int AS value
    `;

    expect(result).toEqual([{ value: 1 }]);
  });

  it("contains every Phase 0 application table", async () => {
    const rows = await requireDatabase().$queryRaw<
      Array<{ table_name: string }>
    >`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'users',
          'sites',
          'source_configs',
          'topics',
          'topic_evidence',
          'topic_scores',
          'audit_logs'
        )
      ORDER BY table_name
    `;

    expect(rows?.map((row) => row.table_name)).toEqual([
      "audit_logs",
      "sites",
      "source_configs",
      "topic_evidence",
      "topic_scores",
      "topics",
      "users",
    ]);
  });
});
