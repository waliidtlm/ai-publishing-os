import {
  createEvidenceFingerprint,
  hashTopicIntakeRequest,
  normalizeTopicTitle,
} from "@ai-publishing-os/shared";
import { describe, expect, it } from "vitest";

describe("normalizeTopicTitle", () => {
  it.each([
    "How to prevent duplicate executions in n8n",
    "how to prevent duplicate executions in n8n",
    "  How   to prevent duplicate executions in n8n  ",
    "How to prevent duplicate executions in n8n?",
  ])("normalizes equivalent title %j", (title) => {
    expect(normalizeTopicTitle(title)).toBe(
      "how to prevent duplicate executions in n8n",
    );
  });

  it("preserves meaningful internal punctuation", () => {
    expect(normalizeTopicTitle("Node.js vs Node js")).not.toBe(
      normalizeTopicTitle("Node js vs Node js"),
    );
  });
});

describe("hashTopicIntakeRequest", () => {
  it("is stable when object key order changes", () => {
    expect(
      hashTopicIntakeRequest({
        metadata: {
          b: 2,
          a: 1,
        },
        title: "Example",
      }),
    ).toBe(
      hashTopicIntakeRequest({
        title: "Example",
        metadata: {
          a: 1,
          b: 2,
        },
      }),
    );
  });

  it("changes when material request data changes", () => {
    expect(hashTopicIntakeRequest({ title: "Example A" })).not.toBe(
      hashTopicIntakeRequest({ title: "Example B" }),
    );
  });
});

describe("createEvidenceFingerprint", () => {
  it("normalizes URL fragments, query ordering, and trailing slashes", () => {
    const first = createEvidenceFingerprint({
      evidenceType: "manual",
      sourceUrl: "https://EXAMPLE.com/path/?b=2&a=1#section",
    });
    const second = createEvidenceFingerprint({
      evidenceType: "manual",
      sourceUrl: "https://example.com/path?a=1&b=2",
    });

    expect(first).toBe(second);
  });

  it("uses source configuration plus external ID when both are available", () => {
    const first = createEvidenceFingerprint({
      evidenceType: "source",
      externalId: "remote-123",
      sourceConfigId: "clh1x2y3z0000qwertyuiopas",
      sourceUrl: "https://example.com/first",
    });
    const second = createEvidenceFingerprint({
      evidenceType: "source",
      externalId: "remote-123",
      sourceConfigId: "clh1x2y3z0000qwertyuiopas",
      sourceUrl: "https://example.com/changed-location",
    });

    expect(first).toBe(second);
  });
});
