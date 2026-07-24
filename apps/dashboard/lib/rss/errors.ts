export type RssCollectorErrorCode =
  | "blocked_destination"
  | "feed_response_too_large"
  | "inactive_rss_source"
  | "invalid_feed_url"
  | "malformed_feed"
  | "rss_source_not_found"
  | "source_not_rss"
  | "upstream_rate_limited"
  | "upstream_request_failed"
  | "upstream_timeout";

export class RssCollectorError extends Error {
  constructor(
    readonly code: RssCollectorErrorCode,
    message: string,
    readonly httpStatus: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "RssCollectorError";
  }
}
