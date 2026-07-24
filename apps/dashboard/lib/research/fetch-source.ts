import {
  OutboundUrlError,
  type OutboundLookup,
  validateOutboundUrl,
} from "../outbound/security";

import { ResearchError } from "./errors";

export interface ResearchFetchLimits {
  maxRedirects: number;
  maxResponseBytes: number;
  timeoutMs: number;
}

export interface ResearchFetchResult {
  body: string;
  contentType: "html" | "plain";
  finalUrl: string;
  httpStatus: number;
}

export interface FetchResearchSourceOptions {
  fetchImplementation?: typeof fetch;
  limits: ResearchFetchLimits;
  lookup?: OutboundLookup;
  retryDelaysMs?: readonly number[];
  sourceUrl: string;
}

function mapOutboundError(error: OutboundUrlError): ResearchError {
  if (error.code === "invalid_url") {
    return new ResearchError(
      "invalid_source_url",
      "The research source URL must use HTTP or HTTPS without credentials.",
      422,
    );
  }

  if (error.code === "resolution_failed") {
    return new ResearchError(
      "upstream_request_failed",
      "The research source hostname could not be resolved.",
      502,
      true,
    );
  }

  return new ResearchError(
    "blocked_destination",
    "The research source destination is not permitted.",
    422,
  );
}

async function validateUrl(rawUrl: string, lookup?: OutboundLookup) {
  try {
    return await validateOutboundUrl(rawUrl, lookup);
  } catch (error) {
    if (error instanceof OutboundUrlError) {
      throw mapOutboundError(error);
    }

    throw error;
  }
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
    throw new ResearchError(
      "content_too_large",
      "The research source exceeds the configured response-size limit.",
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
      throw new ResearchError(
        "content_too_large",
        "The research source exceeds the configured response-size limit.",
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

function classifyContentType(response: Response): "html" | "plain" {
  const raw = response.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();

  if (raw === "text/html" || raw === "application/xhtml+xml") {
    return "html";
  }

  if (
    raw === "text/plain" ||
    raw === "text/markdown" ||
    raw === "text/x-markdown"
  ) {
    return "plain";
  }

  throw new ResearchError(
    "unsupported_content_type",
    "The research source content type is not supported.",
    415,
  );
}

async function fetchResearchSourceOnce({
  fetchImplementation = fetch,
  limits,
  lookup,
  sourceUrl,
}: FetchResearchSourceOptions): Promise<ResearchFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limits.timeoutMs);
  let currentUrl = await validateUrl(sourceUrl, lookup);
  let redirectCount = 0;

  try {
    while (true) {
      let response: Response;

      try {
        response = await fetchImplementation(currentUrl, {
          headers: {
            Accept:
              "text/html, application/xhtml+xml, text/plain;q=0.9, text/markdown;q=0.8",
            "User-Agent": "AI-Publishing-OS-Research-Engine/1.0",
          },
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ResearchError(
            "upstream_timeout",
            "The research source request exceeded the configured timeout.",
            504,
            true,
          );
        }

        if (error instanceof ResearchError) throw error;

        throw new ResearchError(
          "upstream_request_failed",
          "The research source request failed before a response was received.",
          502,
          true,
        );
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirectCount >= limits.maxRedirects) {
          throw new ResearchError(
            "upstream_request_failed",
            "The research source exceeded the redirect limit.",
            502,
          );
        }

        const location = response.headers.get("location");

        if (!location) {
          throw new ResearchError(
            "upstream_request_failed",
            "The research source returned an invalid redirect.",
            502,
          );
        }

        currentUrl = await validateUrl(
          new URL(location, currentUrl).toString(),
          lookup,
        );
        redirectCount += 1;
        continue;
      }

      if (!response.ok) {
        const retryable = [429, 502, 503, 504].includes(response.status);
        throw new ResearchError(
          response.status === 429
            ? "upstream_rate_limited"
            : "upstream_request_failed",
          retryable
            ? "The research source returned a temporary error."
            : "The research source rejected the request.",
          retryable ? 503 : 502,
          retryable,
        );
      }

      const contentType = classifyContentType(response);
      const body = await readLimitedText(response, limits.maxResponseBytes);

      return {
        body,
        contentType,
        finalUrl: currentUrl.toString(),
        httpStatus: response.status,
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchResearchSource(
  options: FetchResearchSourceOptions,
): Promise<ResearchFetchResult> {
  const retryDelays = options.retryDelaysMs ?? [250, 1_000];

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchResearchSourceOnce(options);
    } catch (error) {
      if (
        !(error instanceof ResearchError) ||
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
