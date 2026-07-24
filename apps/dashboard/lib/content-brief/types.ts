import type {
  ContentBriefAdjustment,
  ContentBriefProviderOutput,
} from "@ai-publishing-os/schemas";

export interface SnapshotSourceReference {
  evidenceId: string | null;
  noteId: string;
  sourceQuality:
    "primary" | "official" | "reputable_secondary" | "community" | "unknown";
  sourceTitle: string;
  sourceUrl: string;
  supportingExcerpt: string | null;
}

export interface SnapshotClaim {
  claim: string;
  confidence: "low" | "medium" | "high";
  researchClaimId: string;
  sourceReferences: SnapshotSourceReference[];
}

export interface SnapshotNote {
  claims: SnapshotClaim[];
  contentFingerprint: string;
  definitions: string[];
  examples: string[];
  evidenceId: string | null;
  mode: "deterministic" | "openai";
  noteId: string;
  openQuestions: string[];
  risks: string[];
  sourcePublisher: string | null;
  sourceQuality: SnapshotSourceReference["sourceQuality"];
  sourceTitle: string;
  sourceUrl: string;
  statistics: string[];
  summary: string;
  title: string;
  version: number;
}

export interface BriefResearchSnapshot {
  claims: SnapshotClaim[];
  contradictions: Array<{
    claimReferences: string[];
    description: string;
  }>;
  notes: SnapshotNote[];
  researchJobId: string;
  site: {
    domain: string;
    id: string;
    language: string;
    name: string;
    niche: string | null;
    targetAudience: string | null;
  };
  sources: SnapshotSourceReference[];
  topic: {
    description: string | null;
    id: string;
    title: string;
  };
  version: 1;
}

export interface BriefProviderInput {
  adjustment: ContentBriefAdjustment | null;
  maximumOutlineSections: number;
  snapshot: BriefResearchSnapshot;
}

export interface BriefProviderResult {
  output: ContentBriefProviderOutput;
  usage: {
    estimatedCostUsd: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
  };
}

export interface BriefProvider {
  readonly model: string;
  readonly name: string;
  generate(input: BriefProviderInput): Promise<BriefProviderResult>;
}
