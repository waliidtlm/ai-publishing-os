import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { RssCollectorError } from "../lib/rss/errors";
import {
  createRssIdempotencyKey,
  createStableEntryIdentifier,
  normalizeEntryUrl,
  parseFeedDate,
  parseRssOrAtom,
} from "../lib/rss/mapping";
import { sanitizeErrorSummary, sanitizeFeedText } from "../lib/rss/sanitize";

const fixtureDirectory = resolve(process.cwd(), "..", "..", "fixtures", "rss");

function fixture(name: string): string {
  return readFileSync(resolve(fixtureDirectory, name), "utf8");
}

describe("RSS and Atom mapping", () => {
  it("parses RSS 2.0, skips invalid entries, and sanitizes HTML", () => {
    const parsed = parseRssOrAtom(fixture("sample-feed.xml"), 20);
    const sanitized = parsed.entries.find(
      (entry) => entry.feedEntryId === "fixture-html-003",
    );

    expect(parsed.feedTitle).toBe("AI Publishing OS fixture feed");
    expect(parsed.discoveredCount).toBe(6);
    expect(parsed.returnedCount).toBe(4);
    expect(parsed.skippedCount).toBe(2);
    expect(sanitized?.description).toBe("Keep the useful summary.");
    expect(sanitized?.description).not.toContain("window.evil");
  });

  it("parses Atom links, authors, and optional dates", () => {
    const parsed = parseRssOrAtom(fixture("sample-atom.xml"), 20);

    expect(parsed.returnedCount).toBe(2);
    expect(parsed.entries[0]).toMatchObject({
      author: "Fixture Author",
      publishedAt: "2026-07-24T09:30:00.000Z",
      title: "Collecting Atom entries safely",
      url: "https://fixture.example/atom/safe-collection",
    });
    expect(parsed.entries[1]?.publishedAt).toBeNull();
  });

  it("enforces the newest-first entry limit", () => {
    const parsed = parseRssOrAtom(fixture("sample-feed.xml"), 2);

    expect(parsed.returnedCount).toBe(2);
    expect(parsed.entries.map((entry) => entry.feedEntryId)).toEqual([
      "fixture-normal-001",
      "fixture-duplicate-title-002",
    ]);
  });

  it("fails safely for malformed XML and entity declarations", () => {
    expect(() => parseRssOrAtom(fixture("malformed-feed.xml"), 20)).toThrow(
      RssCollectorError,
    );
    expect(() =>
      parseRssOrAtom(
        '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss/>',
        20,
      ),
    ).toThrow("DTD or entity");
  });

  it("produces deterministic stable IDs and intake keys", () => {
    const input = {
      entryId: "urn:entry:123",
      title: "Stable entry",
      url: "https://example.com/entry",
    };
    const first = createStableEntryIdentifier(input);
    const second = createStableEntryIdentifier({
      ...input,
      url: "https://example.com/moved",
    });

    expect(first).toBe(second);
    expect(createRssIdempotencyKey("source-id", first)).toBe(
      createRssIdempotencyKey("source-id", second),
    );
    expect(
      createRssIdempotencyKey("source-id", first).length,
    ).toBeLessThanOrEqual(200);
  });

  it("validates entry URLs and publication dates", () => {
    expect(normalizeEntryUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeEntryUrl("https://example.com/a#fragment")).toBe(
      "https://example.com/a",
    );
    expect(parseFeedDate("not-a-date")).toBeNull();
    expect(parseFeedDate("2026-07-24T10:00:00Z")).toBe(
      "2026-07-24T10:00:00.000Z",
    );
  });

  it("cleans HTML and redacts likely secrets from safe errors", () => {
    expect(
      sanitizeFeedText(
        "<p>Hello <strong>world</strong></p><script>bad()</script>",
        100,
      ),
    ).toBe("Hello world");
    expect(
      sanitizeErrorSummary(
        "Authorization: Bearer super-secret-value?token=also-secret",
      ),
    ).not.toContain("super-secret");
  });
});
