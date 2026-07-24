import { rssCollectorLimits } from "@ai-publishing-os/schemas";

import { RssCollectorError } from "./errors";
import { parseRssOrAtom } from "./mapping";
import { validateOutboundFeedUrl, type OutboundLookup } from "./security";
import type { FetchFeedResult, RssFetchLimits } from "./types";

export interface FetchConfiguredFeedOptions {
  etag?: string | null;
  fetchImplementation?: typeof fetch;
  feedUrl: string;
  lastModified?: string | null;
  limits: RssFetchLimits;
  lookup?: OutboundLookup;
  retryDelaysMs?: readonly number[];
}

async function readLimitedText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");

  if (
    declaredLength &&
    Number.isFinite(Number(declaredLength)) &&
    Number(declaredLength) > maximumBytes
  ) {
    throw new RssCollectorError(
      "feed_response_too_large",
      "The feed response exceeds the configured size limit.",
      413,
    );
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;
    totalBytes += value.byteLength;

    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new RssCollectorError(
        "feed_response_too_large",
        "The feed response exceeds the configured size limit.",
        413,
      );
    }

    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(body);
}

async function fetchConfiguredFeedOnce({
  etag,
  fetchImplementation = fetch,
  feedUrl,
  lastModified,
  limits,
  lookup,
}: FetchConfiguredFeedOptions): Promise<FetchFeedResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);
  let currentUrl = await validateOutboundFeedUrl(feedUrl, lookup);
  let redirectCount = 0;

  try {
    while (true) {
      const headers = new Headers({
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.2",
        "User-Agent": "AI-Publishing-OS-RSS-Collector/1.0",
      });

      if (etag) headers.set("If-None-Match", etag);
      if (lastModified) headers.set("If-Modified-Since", lastModified);

      let response: Response;

      try {
        response = await fetchImplementation(currentUrl, {
          headers,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new RssCollectorError(
            "upstream_timeout",
            "The feed request exceeded the configured timeout.",
            504,
            true,
          );
        }

        if (error instanceof RssCollectorError) throw error;

        throw new RssCollectorError(
          "upstream_request_failed",
          "The feed request failed before a response was received.",
          502,
          true,
        );
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirectCount >= limits.maxRedirects) {
          throw new RssCollectorError(
            "upstream_request_failed",
            "The feed exceeded the configured redirect limit.",
            502,
          );
        }

        const location = response.headers.get("location");

        if (!location) {
          throw new RssCollectorError(
            "upstream_request_failed",
            "The feed returned an invalid redirect.",
            502,
          );
        }

        currentUrl = await validateOutboundFeedUrl(
          new URL(location, currentUrl).toString(),
          lookup,
        );
        redirectCount += 1;
        continue;
      }

      const responseEtag = response.headers.get("etag");
      const responseLastModified = response.headers.get("last-modified");

      if (response.status === 304) {
        return {
          discoveredCount: 0,
          entries: [],
          etag: responseEtag ?? etag ?? null,
          feedTitle: null,
          httpStatus: 304,
          lastModified: responseLastModified ?? lastModified ?? null,
          notModified: true,
          returnedCount: 0,
          skippedCount: 0,
          status: "not_modified",
        };
      }

      if (!response.ok) {
        const retryable = [429, 502, 503, 504].includes(response.status);
        throw new RssCollectorError(
          response.status === 429
            ? "upstream_rate_limited"
            : "upstream_request_failed",
          retryable
            ? "The feed host returned a temporary error."
            : "The feed host rejected the request.",
          retryable ? 503 : 502,
          retryable,
        );
      }

      const xml = await readLimitedText(response, limits.maxResponseBytes);
      const parsed = parseRssOrAtom(xml, limits.entryLimit);

      return {
        ...parsed,
        etag: responseEtag
          ? responseEtag.slice(0, rssCollectorLimits.etag)
          : null,
        httpStatus: response.status,
        lastModified: responseLastModified
          ? responseLastModified.slice(0, rssCollectorLimits.lastModified)
          : null,
        notModified: false,
        status: "fetched",
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchConfiguredFeed(
  options: FetchConfiguredFeedOptions,
): Promise<FetchFeedResult> {
  const retryDelays = options.retryDelaysMs ?? [250, 1_000];

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchConfiguredFeedOnce(options);
    } catch (error) {
      if (
        !(error instanceof RssCollectorError) ||
        !error.retryable ||
        attempt >= retryDelays.length
      ) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, retryDelays[attempt]);
      });
    }
  }
}
