import { topicIntakeRequestSchema } from "@ai-publishing-os/schemas";
import { describe, expect, it } from "vitest";

const siteId = "clh1x2y3z0000qwertyuiopas";

function validRequest() {
  return {
    idempotencyKey: "unit-test-001",
    siteId,
    source: {
      evidenceType: "manual",
      sourceUrl: "https://example.com/source",
    },
    title: "  A valid topic title  ",
  };
}

describe("topicIntakeRequestSchema", () => {
  it("accepts repository CUIDs and trims user text", () => {
    const parsed = topicIntakeRequestSchema.parse(validRequest());

    expect(parsed.siteId).toBe(siteId);
    expect(parsed.title).toBe("A valid topic title");
  });

  it("requires an HTTP or HTTPS evidence URL", () => {
    const request = validRequest();
    request.source.sourceUrl = "ftp://example.com/source";

    const parsed = topicIntakeRequestSchema.safeParse(request);

    expect(parsed.success).toBe(false);
    expect(
      parsed.error?.issues.some(
        (issue) => issue.path.join(".") === "source.sourceUrl",
      ),
    ).toBe(true);
  });

  it("allows topic intake without evidence", () => {
    const request = validRequest();
    const withoutSource = {
      idempotencyKey: request.idempotencyKey,
      siteId: request.siteId,
      title: request.title,
    };

    expect(topicIntakeRequestSchema.safeParse(withoutSource).success).toBe(
      true,
    );
  });

  it("rejects missing evidence URLs", () => {
    const request = validRequest();
    const source = {
      evidenceType: request.source.evidenceType,
    };

    const parsed = topicIntakeRequestSchema.safeParse({
      ...request,
      source,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects status injection and other unknown fields", () => {
    const parsed = topicIntakeRequestSchema.safeParse({
      ...validRequest(),
      status: "published",
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  it("rejects non-object metadata", () => {
    const parsed = topicIntakeRequestSchema.safeParse({
      ...validRequest(),
      metadata: ["unsafe", "shape"],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects non-CUID site identifiers", () => {
    const parsed = topicIntakeRequestSchema.safeParse({
      ...validRequest(),
      siteId: "not-an-id",
    });

    expect(parsed.success).toBe(false);
  });
});
