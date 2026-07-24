export interface ParsedRssEntry {
  author: string | null;
  description: string | null;
  excerpt: string | null;
  feedEntryId: string | null;
  metadata: Record<string, string>;
  publishedAt: string | null;
  stableId: string;
  title: string;
  updatedAt: string | null;
  url: string;
}

export interface ParsedFeed {
  discoveredCount: number;
  entries: ParsedRssEntry[];
  feedTitle: string | null;
  returnedCount: number;
  skippedCount: number;
}

export interface FetchFeedResult extends ParsedFeed {
  etag: string | null;
  httpStatus: number;
  lastModified: string | null;
  notModified: boolean;
  status: "fetched" | "not_modified";
}

export interface RssFetchLimits {
  entryLimit: number;
  maxRedirects: number;
  maxResponseBytes: number;
  timeoutMs: number;
}
