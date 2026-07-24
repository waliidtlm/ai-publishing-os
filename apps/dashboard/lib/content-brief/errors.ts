export class ContentBriefError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ContentBriefError";
  }
}

export function safeBriefErrorSummary(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
  return normalized ? Array.from(normalized).slice(0, 500).join("") : null;
}
