import { rssCollectorLimits } from "@ai-publishing-os/schemas";

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function truncateText(value: string, maximumLength: number): string {
  const characters = Array.from(value);

  if (characters.length <= maximumLength) {
    return value;
  }

  return characters.slice(0, maximumLength).join("").trimEnd();
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/giu,
    (match, entity: string) => {
      const normalized = entity.toLowerCase();

      if (normalized.startsWith("#x")) {
        const codePoint = Number.parseInt(normalized.slice(2), 16);
        return Number.isSafeInteger(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }

      if (normalized.startsWith("#")) {
        const codePoint = Number.parseInt(normalized.slice(1), 10);
        return Number.isSafeInteger(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }

      return namedEntities[normalized] ?? match;
    },
  );
}

export function sanitizeFeedText(
  value: unknown,
  maximumLength: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const plainText = decodeHtmlEntities(
    value
      .replace(
        /<(script|style|form|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
        " ",
      )
      .replace(/<!--[\s\S]*?-->/gu, " ")
      .replace(/<[^>]*>/gu, " "),
  )
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .trim();

  return plainText ? truncateText(plainText, maximumLength) : null;
}

export function sanitizeErrorSummary(value: unknown): string | null {
  const text = sanitizeFeedText(value, rssCollectorLimits.errorSummary);

  if (!text) {
    return null;
  }

  return truncateText(
    text
      .replace(/\bBearer\s+\S+/giu, "Bearer [REDACTED]")
      .replace(
        /\b(x-api-key|api[_ -]?key|authorization)\b\s*[:=]\s*\S+/giu,
        "$1=[REDACTED]",
      )
      .replace(
        /([?&](?:key|token|secret|password)=)[^&\s]+/giu,
        "$1[REDACTED]",
      ),
    rssCollectorLimits.errorSummary,
  );
}
