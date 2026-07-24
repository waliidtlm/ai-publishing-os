import {
  ResearchJobStatus,
  TrustLevel,
  type PrismaClient,
} from "@ai-publishing-os/database";
import type { ContentBriefEnvironment } from "@ai-publishing-os/schemas";

import { ContentBriefError } from "./errors";
import { fingerprintBriefValue } from "./fingerprint";
import type {
  BriefResearchSnapshot,
  SnapshotClaim,
  SnapshotNote,
  SnapshotSourceReference,
} from "./types";

function stringList(value: unknown, maximum = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => Array.from(item.trim()).slice(0, 1_000).join(""))
    .filter(Boolean)
    .slice(0, maximum);
}

function sourceQuality(options: {
  siteDomain: string;
  sourceTrustLevel: TrustLevel | null;
  sourceUrl: string;
}): SnapshotSourceReference["sourceQuality"] {
  try {
    const hostname = new URL(options.sourceUrl).hostname.toLowerCase();
    const siteDomain = options.siteDomain.toLowerCase();
    if (hostname === siteDomain || hostname.endsWith(`.${siteDomain}`)) {
      return "official";
    }
  } catch {
    return "unknown";
  }

  if (options.sourceTrustLevel === TrustLevel.HIGH) {
    return "reputable_secondary";
  }
  if (options.sourceTrustLevel === TrustLevel.LOW) return "community";
  return "unknown";
}

const sourceQualityPriority: Record<
  SnapshotSourceReference["sourceQuality"],
  number
> = {
  primary: 0,
  official: 1,
  reputable_secondary: 2,
  community: 3,
  unknown: 4,
};

function safeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      value.length <= 2_048
    );
  } catch {
    return false;
  }
}

function sourceHostname(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value;
  }
}

export function prioritizeNotes(
  notes: readonly SnapshotNote[],
  maximum: number,
): SnapshotNote[] {
  const selected: SnapshotNote[] = [];
  const qualities = [
    "primary",
    "official",
    "reputable_secondary",
    "community",
    "unknown",
  ] as const;

  for (const quality of qualities) {
    const byHost = new Map<string, SnapshotNote[]>();
    for (const note of notes.filter(
      (candidate) => candidate.sourceQuality === quality,
    )) {
      const host = sourceHostname(note.sourceUrl);
      const hostNotes = byHost.get(host) ?? [];
      hostNotes.push(note);
      byHost.set(host, hostNotes);
    }

    while (byHost.size > 0 && selected.length < maximum) {
      for (const [host, hostNotes] of byHost) {
        const note = hostNotes.shift();
        if (note) selected.push(note);
        if (hostNotes.length === 0) byHost.delete(host);
        if (selected.length >= maximum) break;
      }
    }
    if (selected.length >= maximum) break;
  }

  return selected;
}

function contradictionKey(value: string): {
  key: string;
  negated: boolean;
} {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const negationPattern =
    /\b(?:cannot|can't|doesn't|does not|isn't|is not|never|no|not|without|won't|will not)\b/iu;
  return {
    key: normalized
      .replace(
        /\b(?:cannot|can't|doesn't|does not|isn't|is not|never|no|not|without|won't|will not)\b/giu,
        " ",
      )
      .replace(/\b(?:are|did|do|does|is|will)\b/giu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .split(" ")
      .map((word) => {
        if (word.length > 4 && word.endsWith("ies"))
          return `${word.slice(0, -3)}y`;
        if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss"))
          return word.slice(0, -1);
        return word;
      })
      .join(" "),
    negated: negationPattern.test(normalized),
  };
}

export function detectContradictions(
  claims: readonly SnapshotClaim[],
): BriefResearchSnapshot["contradictions"] {
  const groups = new Map<
    string,
    { negative: SnapshotClaim[]; positive: SnapshotClaim[] }
  >();
  for (const claim of claims) {
    const normalized = contradictionKey(claim.claim);
    if (!normalized.key) continue;
    const group = groups.get(normalized.key) ?? {
      negative: [],
      positive: [],
    };
    (normalized.negated ? group.negative : group.positive).push(claim);
    groups.set(normalized.key, group);
  }

  return [...groups.values()]
    .filter((group) => group.negative.length > 0 && group.positive.length > 0)
    .map((group) => {
      const claimsInConflict = [...group.positive, ...group.negative];
      return {
        claimReferences: claimsInConflict.map((claim) => claim.researchClaimId),
        description: `Research sources disagree: ${claimsInConflict
          .map((claim) => claim.claim)
          .join(" / ")}`,
      };
    });
}

function parseClaims(options: {
  evidenceId: string | null;
  noteId: string;
  sourceQuality: SnapshotSourceReference["sourceQuality"];
  sourceTitle: string;
  sourceUrl: string;
  value: unknown;
}): SnapshotClaim[] {
  if (!Array.isArray(options.value)) return [];

  return options.value.flatMap((item, index) => {
    if (
      !item ||
      typeof item !== "object" ||
      !("claim" in item) ||
      !("supportingExcerpt" in item) ||
      typeof item.claim !== "string" ||
      typeof item.supportingExcerpt !== "string"
    ) {
      return [];
    }
    const claim = Array.from(item.claim.trim()).slice(0, 1_000).join("");
    const supportingExcerpt = Array.from(item.supportingExcerpt.trim())
      .slice(0, 500)
      .join("");
    if (!claim || !supportingExcerpt) return [];

    const confidence =
      "confidence" in item &&
      (item.confidence === "low" ||
        item.confidence === "medium" ||
        item.confidence === "high")
        ? item.confidence
        : "low";
    return [
      {
        claim,
        confidence,
        researchClaimId: `${options.noteId}:claim:${index}`,
        sourceReferences: [
          {
            evidenceId: options.evidenceId,
            noteId: options.noteId,
            sourceQuality: options.sourceQuality,
            sourceTitle: options.sourceTitle,
            sourceUrl: options.sourceUrl,
            supportingExcerpt,
          },
        ],
      } satisfies SnapshotClaim,
    ];
  });
}

function deduplicateClaims(
  claims: readonly SnapshotClaim[],
  maximum: number,
): SnapshotClaim[] {
  const selected = new Map<string, SnapshotClaim>();
  for (const claim of claims) {
    const key = claim.claim
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/\s+/gu, " ")
      .trim();
    const existing = selected.get(key);
    if (existing) {
      existing.sourceReferences.push(...claim.sourceReferences);
      continue;
    }
    if (selected.size < maximum) selected.set(key, structuredClone(claim));
  }
  return [...selected.values()];
}

export async function selectBriefResearchInput(options: {
  database: PrismaClient;
  environment: ContentBriefEnvironment;
  topicId: string;
}): Promise<{
  fingerprint: string;
  researchJobId: string;
  snapshot: BriefResearchSnapshot;
}> {
  const topic = await options.database.topic.findUnique({
    include: {
      site: true,
    },
    where: { id: options.topicId },
  });
  if (!topic) {
    throw new ContentBriefError(
      "topic_not_found",
      "The content-brief topic was not found.",
      404,
    );
  }

  const researchJob = await options.database.researchJob.findFirst({
    include: {
      notes: {
        include: {
          evidence: {
            select: { topicId: true },
          },
          researchJobSource: {
            include: {
              sourceConfig: {
                select: { trustLevel: true },
              },
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: options.environment.CONTENT_BRIEF_MAX_NOTES * 5,
      },
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    where: {
      siteId: topic.siteId,
      status: {
        in: [ResearchJobStatus.COMPLETED, ResearchJobStatus.PARTIAL],
      },
      topicId: topic.id,
    },
  });

  if (!researchJob) {
    throw new ContentBriefError(
      "research_input_not_found",
      "No completed or partial research job is available for this topic.",
      422,
    );
  }

  const notes: SnapshotNote[] = researchJob.notes.flatMap((note) => {
    if (
      note.siteId !== topic.siteId ||
      note.topicId !== topic.id ||
      note.researchJobId !== researchJob.id ||
      (note.evidenceId !== null && note.evidence?.topicId !== topic.id) ||
      !safeHttpUrl(note.sourceUrl) ||
      !note.sourceTitle.trim() ||
      !note.summary.trim()
    ) {
      return [];
    }
    const quality = sourceQuality({
      siteDomain: topic.site.domain,
      sourceTrustLevel: note.researchJobSource.sourceConfig?.trustLevel ?? null,
      sourceUrl: note.sourceUrl,
    });
    const claims = parseClaims({
      evidenceId: note.evidenceId,
      noteId: note.id,
      sourceQuality: quality,
      sourceTitle: Array.from(note.sourceTitle).slice(0, 300).join(""),
      sourceUrl: note.sourceUrl,
      value: note.claims,
    });
    return [
      {
        claims,
        contentFingerprint: note.contentFingerprint,
        definitions: stringList(note.definitions),
        evidenceId: note.evidenceId,
        examples: stringList(note.examples),
        mode: note.mode.toLowerCase() as "deterministic" | "openai",
        noteId: note.id,
        openQuestions: stringList(note.openQuestions),
        risks: stringList(note.risks),
        sourcePublisher: note.sourcePublisher
          ? Array.from(note.sourcePublisher).slice(0, 300).join("")
          : null,
        sourceQuality: quality,
        sourceTitle: Array.from(note.sourceTitle).slice(0, 300).join(""),
        sourceUrl: note.sourceUrl,
        statistics: stringList(note.statistics),
        summary: Array.from(note.summary).slice(0, 4_000).join(""),
        title: Array.from(note.title).slice(0, 300).join(""),
        version: note.version,
      },
    ];
  });

  if (notes.length === 0) {
    throw new ContentBriefError(
      "insufficient_research",
      "The selected research job has no usable research notes.",
      422,
    );
  }

  const prioritizedNotes = prioritizeNotes(
    notes.sort(
      (left, right) =>
        sourceQualityPriority[left.sourceQuality] -
        sourceQualityPriority[right.sourceQuality],
    ),
    options.environment.CONTENT_BRIEF_MAX_NOTES,
  );
  const claims = deduplicateClaims(
    prioritizedNotes.flatMap((note) => note.claims),
    options.environment.CONTENT_BRIEF_MAX_CLAIMS,
  );
  const selectedClaimIds = new Set(
    claims.flatMap((claim) =>
      claim.sourceReferences.map((reference) => reference.noteId),
    ),
  );
  const selectedNotes = prioritizedNotes.filter(
    (note) =>
      selectedClaimIds.has(note.noteId) ||
      (note.mode === "deterministic" && note.summary.length >= 40),
  );
  if (claims.length === 0 && selectedNotes.length === 0) {
    throw new ContentBriefError(
      "insufficient_research",
      "The selected research does not contain a usable grounded claim or deterministic note.",
      422,
    );
  }

  const sources = selectedNotes
    .map((note) => ({
      evidenceId: note.evidenceId,
      noteId: note.noteId,
      sourceQuality: note.sourceQuality,
      sourceTitle: note.sourceTitle,
      sourceUrl: note.sourceUrl,
      supportingExcerpt:
        note.claims[0]?.sourceReferences[0]?.supportingExcerpt ?? null,
    }))
    .slice(0, options.environment.CONTENT_BRIEF_MAX_SOURCES);
  const sourceNoteIds = new Set(sources.map((source) => source.noteId));
  const selectedClaims = claims.flatMap((claim) => {
    const sourceReferences = claim.sourceReferences.filter((reference) =>
      sourceNoteIds.has(reference.noteId),
    );
    return sourceReferences.length > 0 ? [{ ...claim, sourceReferences }] : [];
  });
  const snapshot: BriefResearchSnapshot = {
    claims: selectedClaims,
    contradictions: detectContradictions(selectedClaims),
    notes: selectedNotes.filter((note) => sourceNoteIds.has(note.noteId)),
    researchJobId: researchJob.id,
    site: {
      domain: topic.site.domain,
      id: topic.site.id,
      language: topic.site.language,
      name: topic.site.name,
      niche: topic.site.niche,
      targetAudience: topic.site.targetAudience,
    },
    sources,
    topic: {
      description: topic.description,
      id: topic.id,
      title: topic.title,
    },
    version: 1,
  };
  const serialized = JSON.stringify(snapshot);
  if (
    Array.from(serialized).length >
    options.environment.CONTENT_BRIEF_MAX_PROMPT_CHARS
  ) {
    throw new ContentBriefError(
      "research_input_too_large",
      "The selected research snapshot exceeds the configured prompt limit.",
      422,
    );
  }

  return {
    fingerprint: fingerprintBriefValue(snapshot),
    researchJobId: researchJob.id,
    snapshot,
  };
}

export { deduplicateClaims };
