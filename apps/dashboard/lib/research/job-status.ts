import { ResearchJobStatus } from "@ai-publishing-os/database";

export function calculateResearchJobStatus(input: {
  failedSourceCount: number;
  generatedNoteCount: number;
  skippedSourceCount: number;
}): ResearchJobStatus {
  if (input.generatedNoteCount === 0) {
    return ResearchJobStatus.FAILED;
  }

  if (input.failedSourceCount > 0 || input.skippedSourceCount > 0) {
    return ResearchJobStatus.PARTIAL;
  }

  return ResearchJobStatus.COMPLETED;
}
