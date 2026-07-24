import { createHash } from "node:crypto";

import {
  rssCollectorLimits,
  topicIntakeLimits,
} from "@ai-publishing-os/schemas";
import { XMLParser, XMLValidator } from "fast-xml-parser";

import { RssCollectorError } from "./errors";
import { sanitizeFeedText, truncateText } from "./sanitize";
import type { ParsedFeed, ParsedRssEntry } from "./types";

type XmlRecord = Record<string, unknown>;

function asRecord(value: unknown): XmlRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlRecord)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function textValue(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  const record = asRecord(value);
  return record ? textValue(record["#text"] ?? record._text) : null;
}

function parseDate(value: unknown): string | null {
  const text = textValue(value)?.trim();

  if (!text) {
    return null;
  }

  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function normalizeEntryUrl(value: unknown): string | null {
  const text = textValue(value)?.trim();

  if (!text || text.length > rssCollectorLimits.url) {
    return null;
  }

  try {
    const url = new URL(text);

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }

    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function atomLink(value: unknown): string | null {
  for (const candidate of asArray(value)) {
    const record = asRecord(candidate);

    if (!record) {
      const direct = normalizeEntryUrl(candidate);
      if (direct) return direct;
      continue;
    }

    const relation = textValue(record["@_rel"])?.toLowerCase();
    const href = normalizeEntryUrl(record["@_href"]);

    if (href && (!relation || relation === "alternate")) {
      return href;
    }
  }

  return null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createStableEntryIdentifier(input: {
  description?: string | null;
  entryId?: string | null;
  publishedAt?: string | null;
  title: string;
  url?: string | null;
}): string {
  const entryId = input.entryId?.normalize("NFKC").trim();
  const identity = entryId
    ? `id:${entryId}`
    : input.url
      ? `url:${input.url}`
      : `fields:${input.title.normalize("NFKC").trim()}\n${
          input.publishedAt ?? ""
        }\n${input.description?.normalize("NFKC").trim() ?? ""}`;

  return `rss_${sha256(identity)}`;
}

export function createRssIdempotencyKey(
  sourceConfigId: string,
  stableId: string,
): string {
  return truncateText(
    `rss:${sourceConfigId}:${stableId}`,
    topicIntakeLimits.idempotencyKey,
  );
}

interface Candidate {
  author: unknown;
  description: unknown;
  entryId: unknown;
  published: unknown;
  title: unknown;
  updated: unknown;
  url: unknown;
}

function mapCandidate(candidate: Candidate): ParsedRssEntry | null {
  const title = sanitizeFeedText(
    textValue(candidate.title),
    rssCollectorLimits.title,
  );
  const url = normalizeEntryUrl(candidate.url);

  if (!title || !url) {
    return null;
  }

  const description = sanitizeFeedText(
    textValue(candidate.description),
    topicIntakeLimits.description,
  );
  const excerpt = sanitizeFeedText(
    textValue(candidate.description),
    rssCollectorLimits.excerpt,
  );
  const author = sanitizeFeedText(
    textValue(candidate.author),
    rssCollectorLimits.author,
  );
  const publishedAt = parseDate(candidate.published);
  const updatedAt = parseDate(candidate.updated);
  const feedEntryId = sanitizeFeedText(
    textValue(candidate.entryId),
    topicIntakeLimits.externalId,
  );
  const stableId = createStableEntryIdentifier({
    description,
    entryId: feedEntryId,
    publishedAt,
    title,
    url,
  });

  return {
    author,
    description,
    excerpt,
    feedEntryId,
    metadata: {},
    publishedAt,
    stableId,
    title,
    updatedAt,
    url,
  };
}

function rssCandidate(value: unknown): Candidate {
  const item = asRecord(value) ?? {};

  return {
    author: item.author ?? item.creator,
    description:
      item.description ?? item.summary ?? item.encoded ?? item.content,
    entryId: item.guid ?? item.id,
    published: item.pubDate ?? item.published ?? item.date,
    title: item.title,
    updated: item.updated,
    url: item.link,
  };
}

function atomCandidate(value: unknown): Candidate {
  const entry = asRecord(value) ?? {};
  const author = asRecord(entry.author);

  return {
    author: author?.name ?? entry.author,
    description: entry.summary ?? entry.content,
    entryId: entry.id,
    published: entry.published,
    title: entry.title,
    updated: entry.updated,
    url: atomLink(entry.link),
  };
}

export function parseRssOrAtom(xml: string, entryLimit: number): ParsedFeed {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new RssCollectorError(
      "malformed_feed",
      "Feeds containing DTD or entity declarations are not accepted.",
      422,
    );
  }

  const validation = XMLValidator.validate(xml);

  if (validation !== true) {
    throw new RssCollectorError(
      "malformed_feed",
      "The upstream response is not valid RSS or Atom XML.",
      422,
    );
  }

  let parsed: unknown;

  try {
    parsed = new XMLParser({
      allowBooleanAttributes: true,
      attributeNamePrefix: "@_",
      htmlEntities: false,
      ignoreAttributes: false,
      parseTagValue: false,
      processEntities: false,
      removeNSPrefix: true,
      trimValues: false,
    }).parse(xml);
  } catch {
    throw new RssCollectorError(
      "malformed_feed",
      "The upstream response could not be parsed as RSS or Atom.",
      422,
    );
  }

  const document = asRecord(parsed) ?? {};
  const rssChannel = asRecord(asRecord(document.rss)?.channel);
  const atomFeed = asRecord(document.feed);
  let rawEntries: unknown[];
  let candidates: Candidate[];
  let feedTitle: string | null;

  if (rssChannel) {
    rawEntries = asArray(rssChannel.item);
    candidates = rawEntries.map(rssCandidate);
    feedTitle = sanitizeFeedText(
      rssChannel.title,
      rssCollectorLimits.feedTitle,
    );
  } else if (atomFeed) {
    rawEntries = asArray(atomFeed.entry);
    candidates = rawEntries.map(atomCandidate);
    feedTitle = sanitizeFeedText(atomFeed.title, rssCollectorLimits.feedTitle);
  } else {
    throw new RssCollectorError(
      "malformed_feed",
      "The upstream XML is not a supported RSS 2.0 or Atom feed.",
      422,
    );
  }

  const discoveredCount = rawEntries.length;
  const maximumScannedEntries = Math.min(500, Math.max(100, entryLimit * 5));
  const mapped = candidates
    .slice(0, maximumScannedEntries)
    .map(mapCandidate)
    .filter((entry): entry is ParsedRssEntry => entry !== null)
    .sort((left, right) => {
      const leftDate = left.publishedAt ?? left.updatedAt;
      const rightDate = right.publishedAt ?? right.updatedAt;

      if (!leftDate && !rightDate) return 0;
      if (!leftDate) return 1;
      if (!rightDate) return -1;
      return Date.parse(rightDate) - Date.parse(leftDate);
    })
    .slice(0, entryLimit);

  return {
    discoveredCount,
    entries: mapped,
    feedTitle,
    returnedCount: mapped.length,
    skippedCount: discoveredCount - mapped.length,
  };
}

export { parseDate as parseFeedDate };
