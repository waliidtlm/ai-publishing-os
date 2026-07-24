import { describe, expect, it, vi } from "vitest";

import { RssCollectorError } from "../lib/rss/errors";
import { fetchConfiguredFeed } from "../lib/rss/fetch-feed";
import {
  isBlockedIpAddress,
  validateOutboundFeedUrl,
} from "../lib/rss/security";

const publicLookup = async () => [
  {
    address: "93.184.216.34",
    family: 4,
  },
];

const limits = {
  entryLimit: 20,
  maxRedirects: 2,
  maxResponseBytes: 1_024,
  timeoutMs: 1_000,
};

describe("RSS outbound request security", () => {
  it("blocks loopback, private, link-local, and private IPv6 addresses", () => {
    expect(isBlockedIpAddress("127.0.0.1")).toBe(true);
    expect(isBlockedIpAddress("10.0.0.1")).toBe(true);
    expect(isBlockedIpAddress("169.254.169.254")).toBe(true);
    expect(isBlockedIpAddress("192.168.1.1")).toBe(true);
    expect(isBlockedIpAddress("::1")).toBe(true);
    expect(isBlockedIpAddress("fd00::1")).toBe(true);
    expect(isBlockedIpAddress("93.184.216.34")).toBe(false);
  });

  it("rejects unsupported schemes, credentials, and private DNS results", async () => {
    await expect(
      validateOutboundFeedUrl("file:///etc/passwd", publicLookup),
    ).rejects.toMatchObject({ code: "invalid_feed_url" });
    await expect(
      validateOutboundFeedUrl(
        "https://user:password@example.com/feed",
        publicLookup,
      ),
    ).rejects.toMatchObject({ code: "invalid_feed_url" });
    await expect(
      validateOutboundFeedUrl("https://example.com/feed", async () => [
        { address: "10.0.0.2", family: 4 },
      ]),
    ).rejects.toMatchObject({ code: "blocked_destination" });
  });

  it("revalidates redirect destinations", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response(null, {
          headers: {
            location: "http://127.0.0.1/private",
          },
          status: 302,
        }),
    );

    await expect(
      fetchConfiguredFeed({
        feedUrl: "https://example.com/feed",
        fetchImplementation,
        limits,
        lookup: publicLookup,
      }),
    ).rejects.toMatchObject({ code: "blocked_destination" });
  });

  it("enforces the response-size limit", async () => {
    const fetchImplementation = vi.fn(
      async () =>
        new Response("x".repeat(2_000), {
          headers: {
            "content-length": "2000",
          },
          status: 200,
        }),
    );

    await expect(
      fetchConfiguredFeed({
        feedUrl: "https://example.com/feed",
        fetchImplementation,
        limits,
        lookup: publicLookup,
      }),
    ).rejects.toBeInstanceOf(RssCollectorError);
  });

  it("returns a structured unchanged result for 304", async () => {
    const fetchImplementation = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("if-none-match")).toBe('"v1"');
        return new Response(null, {
          headers: {
            etag: '"v1"',
          },
          status: 304,
        });
      },
    );

    const result = await fetchConfiguredFeed({
      etag: '"v1"',
      feedUrl: "https://example.com/feed",
      fetchImplementation,
      limits,
      lookup: publicLookup,
    });

    expect(result).toMatchObject({
      entries: [],
      etag: '"v1"',
      httpStatus: 304,
      notModified: true,
      status: "not_modified",
    });
  });

  it("retries bounded temporary upstream failures only", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }));

    await expect(
      fetchConfiguredFeed({
        feedUrl: "https://example.com/feed",
        fetchImplementation,
        limits,
        lookup: publicLookup,
        retryDelaysMs: [0, 0],
      }),
    ).rejects.toMatchObject({
      code: "upstream_rate_limited",
      retryable: true,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });
});
