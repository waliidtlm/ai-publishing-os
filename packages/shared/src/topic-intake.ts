import { createHash } from "node:crypto";

export interface EvidenceFingerprintInput {
  evidenceType: string;
  externalId?: string;
  sourceConfigId?: string;
  sourceUrl: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }

  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeTopicTitle(title: string): string {
  return title
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US")
    .replace(/[?!.]+$/gu, "")
    .trim();
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashTopicIntakeRequest(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function normalizeEvidenceUrl(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  url.hash = "";
  url.searchParams.sort();

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/u, "");
  }

  return url.toString();
}

export function createEvidenceFingerprint({
  evidenceType,
  externalId,
  sourceConfigId,
  sourceUrl,
}: EvidenceFingerprintInput): string {
  const identity =
    externalId && sourceConfigId
      ? {
          evidenceType,
          externalId,
          sourceConfigId,
        }
      : {
          evidenceType,
          sourceUrl: normalizeEvidenceUrl(sourceUrl),
        };

  return sha256(canonicalJson(identity));
}
