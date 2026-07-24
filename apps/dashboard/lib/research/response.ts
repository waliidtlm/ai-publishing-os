import type {
  ResearchJobStatus,
  ResearchMode,
} from "@ai-publishing-os/database";

export interface ResearchJobSummaryInput {
  completedAt: Date | null;
  createdAt: Date;
  deterministicFallbackUsed: boolean;
  failedAt: Date | null;
  failedSourceCount: number;
  generatedNoteCount: number;
  id: string;
  mode: ResearchMode;
  selectedEvidenceCount: number;
  siteId: string;
  skippedSourceCount: number;
  startedAt: Date | null;
  status: ResearchJobStatus;
  successfulSourceCount: number;
  topicId: string;
}

export function mapResearchJobSummary(job: ResearchJobSummaryInput) {
  return {
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    deterministicFallbackUsed: job.deterministicFallbackUsed,
    failedAt: job.failedAt?.toISOString() ?? null,
    failedSourceCount: job.failedSourceCount,
    generatedNoteCount: job.generatedNoteCount,
    id: job.id,
    mode: job.mode.toLowerCase(),
    selectedEvidenceCount: job.selectedEvidenceCount,
    siteId: job.siteId,
    skippedSourceCount: job.skippedSourceCount,
    startedAt: job.startedAt?.toISOString() ?? null,
    status: job.status.toLowerCase(),
    successfulSourceCount: job.successfulSourceCount,
    topicId: job.topicId,
  };
}
