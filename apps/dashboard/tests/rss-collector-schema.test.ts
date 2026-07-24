import {
  rssCollectionResultSchema,
  rssFetchRequestSchema,
  rssSourceListQuerySchema,
} from "@ai-publishing-os/schemas";
import { describe, expect, it } from "vitest";

const runId = "clh1x2y3z0000qwertyuiopas";

function completedResult() {
  return {
    acceptedCount: 2,
    discoveredCount: 4,
    durationMs: 120,
    failedCount: 0,
    matchedCount: 1,
    returnedCount: 3,
    runId,
    skippedCount: 1,
    status: "succeeded",
    submittedCount: 2,
  };
}

describe("RSS collector schemas", () => {
  it("accepts a collection start", () => {
    expect(
      rssCollectionResultSchema.parse({
        status: "started",
        workflowExecutionId: "n8n-execution-1",
      }),
    ).toMatchObject({ status: "started" });
  });

  it("accepts internally consistent completion counts", () => {
    expect(rssCollectionResultSchema.safeParse(completedResult()).success).toBe(
      true,
    );
  });

  it("rejects impossible collection counts", () => {
    const parsed = rssCollectionResultSchema.safeParse({
      ...completedResult(),
      submittedCount: 4,
    });

    expect(parsed.success).toBe(false);
  });

  it("requires a safe error code for failed collections", () => {
    const parsed = rssCollectionResultSchema.safeParse({
      ...completedResult(),
      status: "failed",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects excessive request limits and unknown query fields", () => {
    expect(rssFetchRequestSchema.safeParse({ entryLimit: 101 }).success).toBe(
      false,
    );
    expect(
      rssSourceListQuerySchema.safeParse({ includeSecrets: "true" }).success,
    ).toBe(false);
  });
});
