import { researchLimits } from "@ai-publishing-os/schemas";

export function truncateResearchText(
  value: string,
  maximumLength: number,
): string {
  const characters = Array.from(value);

  if (characters.length <= maximumLength) {
    return value;
  }

  return characters.slice(0, maximumLength).join("").trimEnd();
}

export function normalizeResearchText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ")
    .replace(/\r\n?/gu, "\n")
    .replace(/[^\S\n]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function sanitizeResearchError(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = normalizeResearchText(value)
    .replace(/\bBearer\s+\S+/giu, "Bearer [REDACTED]")
    .replace(
      /\b(x-api-key|api[_ -]?key|authorization)\b\s*[:=]\s*\S+/giu,
      "$1=[REDACTED]",
    )
    .replace(/([?&](?:key|token|secret|password)=)[^&\s]+/giu, "$1[REDACTED]");

  return sanitized
    ? truncateResearchText(sanitized, researchLimits.errorSummary)
    : null;
}
