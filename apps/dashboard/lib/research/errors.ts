export type ResearchErrorCode =
  | "active_research_job_exists"
  | "ai_configuration_error"
  | "ai_invalid_output"
  | "ai_provider_failed"
  | "ai_rate_limited"
  | "blocked_destination"
  | "content_too_large"
  | "ineligible_topic"
  | "invalid_job_state"
  | "invalid_source_url"
  | "no_research_sources"
  | "no_usable_content"
  | "research_job_not_found"
  | "research_concurrency_limited"
  | "research_source_not_found"
  | "topic_not_found"
  | "unsupported_content_type"
  | "upstream_rate_limited"
  | "upstream_request_failed"
  | "upstream_timeout";

export class ResearchError extends Error {
  constructor(
    readonly code: ResearchErrorCode,
    message: string,
    readonly httpStatus: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ResearchError";
  }
}
