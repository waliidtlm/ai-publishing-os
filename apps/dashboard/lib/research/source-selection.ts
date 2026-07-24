import type { SourceType } from "@ai-publishing-os/database";

export interface ResearchEvidenceCandidate {
  collectedAt: Date;
  evidenceFingerprint: string | null;
  id: string;
  sourceConfigId: string | null;
  sourceTitle: string | null;
  sourceUrl: string;
}

export interface ResearchSourceConfigurationCandidate {
  baseUrl: string | null;
  id: string;
  isActive: boolean;
  name: string;
  sourceType: SourceType;
}

export interface SelectedResearchSource {
  canonicalUrl: string;
  evidenceId: string | null;
  selectionRank: number;
  sourceConfigId: string | null;
  sourceTitle: string | null;
  sourceUrl: string;
}

const ignoredQueryParameters = new Set(["fbclid", "gclid", "mc_cid", "mc_eid"]);

export function canonicalizeResearchUrl(rawUrl: string): string | null {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    return null;
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }

  const parameters = [...url.searchParams.entries()]
    .filter(
      ([key]) =>
        !key.toLowerCase().startsWith("utm_") &&
        !ignoredQueryParameters.has(key.toLowerCase()),
    )
    .sort(([firstKey, firstValue], [secondKey, secondValue]) =>
      `${firstKey}=${firstValue}`.localeCompare(`${secondKey}=${secondValue}`),
    );

  url.search = "";

  for (const [key, value] of parameters) {
    url.searchParams.append(key, value);
  }

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/u, "");
  }

  return url.toString();
}

export function selectResearchSources(input: {
  evidence: readonly ResearchEvidenceCandidate[];
  limit: number;
  sourceConfigurations: readonly ResearchSourceConfigurationCandidate[];
}): SelectedResearchSource[] {
  const selected: Omit<SelectedResearchSource, "selectionRank">[] = [];
  const identities = new Set<string>();

  const add = (
    candidate: Omit<SelectedResearchSource, "canonicalUrl" | "selectionRank">,
  ) => {
    const canonicalUrl = canonicalizeResearchUrl(candidate.sourceUrl);

    if (!canonicalUrl || identities.has(canonicalUrl)) {
      return;
    }

    identities.add(canonicalUrl);
    selected.push({ ...candidate, canonicalUrl });
  };

  for (const evidence of [...input.evidence].sort(
    (first, second) =>
      second.collectedAt.getTime() - first.collectedAt.getTime() ||
      first.id.localeCompare(second.id),
  )) {
    add({
      evidenceId: evidence.id,
      sourceConfigId: evidence.sourceConfigId,
      sourceTitle: evidence.sourceTitle,
      sourceUrl: evidence.sourceUrl,
    });
  }

  for (const source of [...input.sourceConfigurations].sort(
    (first, second) =>
      first.name.localeCompare(second.name) ||
      first.id.localeCompare(second.id),
  )) {
    if (
      !source.isActive ||
      !source.baseUrl ||
      !["WEBSITE", "MANUAL"].includes(source.sourceType)
    ) {
      continue;
    }

    add({
      evidenceId: null,
      sourceConfigId: source.id,
      sourceTitle: source.name,
      sourceUrl: source.baseUrl,
    });
  }

  return selected.slice(0, input.limit).map((source, selectionRank) => ({
    ...source,
    selectionRank,
  }));
}
