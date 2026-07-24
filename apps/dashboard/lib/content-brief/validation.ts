import {
  contentBriefProviderOutputSchema,
  type ContentBriefProviderOutput,
} from "@ai-publishing-os/schemas";
import {
  ResearchJobStatus,
  type PrismaClient,
} from "@ai-publishing-os/database";

import { ContentBriefError } from "./errors";
import type { BriefResearchSnapshot, SnapshotSourceReference } from "./types";

export const requiredQualityChecklist = [
  "Answers the primary reader question.",
  "Follows the approved outline.",
  "Uses only validated claims.",
  "Cites every required source.",
  "Distinguishes fact from inference.",
  "Includes relevant caveats.",
  "Avoids unsupported statistics.",
  "Does not fabricate quotations.",
  "Avoids duplicated sections.",
  "Uses the intended audience level.",
  "Respects the word-count range.",
] as const;

function normalizedHeading(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function sourceMatches(
  reference: {
    evidenceId: string | null;
    noteId: string;
    sourceTitle: string;
    sourceUrl: string;
    supportingExcerpt?: string | null;
  },
  allowed: SnapshotSourceReference,
  snapshot: BriefResearchSnapshot,
): boolean {
  if (
    reference.noteId !== allowed.noteId ||
    reference.evidenceId !== allowed.evidenceId ||
    reference.sourceTitle !== allowed.sourceTitle ||
    reference.sourceUrl !== allowed.sourceUrl
  ) {
    return false;
  }
  if (
    !("supportingExcerpt" in reference) ||
    reference.supportingExcerpt === null
  )
    return true;
  return snapshot.claims.some(
    (claim) =>
      claim.researchClaimId.startsWith(`${reference.noteId}:claim:`) &&
      claim.sourceReferences.some(
        (source) =>
          source.noteId === reference.noteId &&
          source.supportingExcerpt === reference.supportingExcerpt,
      ),
  );
}

function claimSourceMatches(
  reference: Parameters<typeof sourceMatches>[0],
  allowed: SnapshotSourceReference,
): boolean {
  return (
    reference.noteId === allowed.noteId &&
    reference.evidenceId === allowed.evidenceId &&
    reference.sourceTitle === allowed.sourceTitle &&
    reference.sourceUrl === allowed.sourceUrl &&
    (!("supportingExcerpt" in reference) ||
      reference.supportingExcerpt === allowed.supportingExcerpt)
  );
}

export async function verifyBriefResearchSnapshotOwnership(options: {
  database: PrismaClient;
  researchJobId: string;
  siteId: string;
  snapshot: BriefResearchSnapshot;
  topicId: string;
}): Promise<void> {
  const { snapshot } = options;
  if (
    snapshot.version !== 1 ||
    snapshot.researchJobId !== options.researchJobId ||
    snapshot.site?.id !== options.siteId ||
    snapshot.topic?.id !== options.topicId ||
    !Array.isArray(snapshot.notes) ||
    !Array.isArray(snapshot.claims) ||
    !Array.isArray(snapshot.sources) ||
    !Array.isArray(snapshot.contradictions)
  ) {
    throw new ContentBriefError(
      "invalid_research_snapshot",
      "The stored research snapshot does not match its brief-generation job.",
      422,
    );
  }

  const noteIds = [...new Set(snapshot.notes.map((note) => note.noteId))];
  const snapshotNoteIds = new Set(noteIds);
  const sourceNoteIds = snapshot.sources.map((source) => source.noteId);
  const claimIds = snapshot.claims.map((claim) => claim.researchClaimId);
  const snapshotClaimIds = new Set(claimIds);
  const evidenceIds = [
    ...new Set(
      snapshot.sources
        .map((source) => source.evidenceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const referencesAreInternal = snapshot.claims.every(
    (claim) =>
      claim.sourceReferences.length > 0 &&
      claim.sourceReferences.every(
        (reference) =>
          snapshotNoteIds.has(reference.noteId) &&
          snapshot.sources.some((source) =>
            sourceMatches(reference, source, snapshot),
          ),
      ),
  );
  if (
    noteIds.length !== snapshot.notes.length ||
    noteIds.length === 0 ||
    new Set(sourceNoteIds).size !== sourceNoteIds.length ||
    snapshotClaimIds.size !== claimIds.length ||
    sourceNoteIds.some((noteId) => !snapshotNoteIds.has(noteId)) ||
    snapshot.contradictions.some(
      (contradiction) =>
        contradiction.claimReferences.length < 2 ||
        contradiction.claimReferences.some(
          (claimId) => !snapshotClaimIds.has(claimId),
        ),
    ) ||
    !referencesAreInternal
  ) {
    throw new ContentBriefError(
      "invalid_research_snapshot",
      "The stored research snapshot contains inconsistent provenance.",
      422,
    );
  }

  const [researchJob, noteCount, evidenceCount] = await Promise.all([
    options.database.researchJob.findFirst({
      select: { id: true },
      where: {
        id: options.researchJobId,
        siteId: options.siteId,
        status: {
          in: [ResearchJobStatus.COMPLETED, ResearchJobStatus.PARTIAL],
        },
        topicId: options.topicId,
      },
    }),
    options.database.researchNote.count({
      where: {
        id: { in: noteIds },
        researchJobId: options.researchJobId,
        siteId: options.siteId,
        topicId: options.topicId,
      },
    }),
    options.database.topicEvidence.count({
      where: {
        id: { in: evidenceIds },
        topicId: options.topicId,
      },
    }),
  ]);
  if (
    !researchJob ||
    noteCount !== noteIds.length ||
    evidenceCount !== evidenceIds.length
  ) {
    throw new ContentBriefError(
      "invalid_research_snapshot",
      "Research snapshot references do not belong to the selected topic and site.",
      422,
    );
  }
}

export function validateBriefOutput(
  value: unknown,
  snapshot: BriefResearchSnapshot,
  limits: { maximumOutlineSections: number } = {
    maximumOutlineSections: 12,
  },
): ContentBriefProviderOutput {
  const parsed = contentBriefProviderOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new ContentBriefError(
      "ai_invalid_output",
      "The brief provider returned invalid structured output.",
      502,
    );
  }
  const brief = parsed.data;
  if (
    /^(?:anyone|everyone|general readers?|people interested)\b/iu.test(
      brief.targetAudience.description,
    )
  ) {
    throw new ContentBriefError(
      "invalid_target_audience",
      "The generated target audience is too vague.",
      422,
    );
  }
  if (
    brief.estimatedWordCount.maximum < brief.estimatedWordCount.minimum ||
    brief.estimatedWordCount.maximum > brief.estimatedWordCount.minimum * 3
  ) {
    throw new ContentBriefError(
      "invalid_word_count",
      "The generated word-count range is invalid.",
      422,
    );
  }
  const titles = [brief.primaryTitle, ...brief.alternativeTitles];
  if (
    titles.some((title) =>
      /\b(best|ultimate|guaranteed|unbeatable)\b/iu.test(title),
    )
  ) {
    throw new ContentBriefError(
      "invalid_title",
      "The generated title contains an unsupported promotional claim.",
      422,
    );
  }
  const normalizedTitles = titles.map(normalizedHeading);
  if (new Set(normalizedTitles).size !== normalizedTitles.length) {
    throw new ContentBriefError(
      "invalid_title",
      "The generated title suggestions must be distinct.",
      422,
    );
  }
  const supportedTitleText = [
    snapshot.topic.title,
    snapshot.topic.description ?? "",
    ...snapshot.claims.map((claim) => claim.claim),
    ...snapshot.notes.flatMap((note) => [
      note.summary,
      ...note.definitions,
      ...note.examples,
      ...note.statistics,
    ]),
  ].join(" ");
  const titleNumbers = titles.flatMap(
    (title) => title.match(/\b\d+(?:[.,]\d+)?%?\b/gu) ?? [],
  );
  if (titleNumbers.some((number) => !supportedTitleText.includes(number))) {
    throw new ContentBriefError(
      "invalid_title",
      "The generated title contains a number not supported by the research snapshot.",
      422,
    );
  }
  const headings = brief.outline.map((section) =>
    normalizedHeading(section.heading),
  );
  if (new Set(headings).size !== headings.length) {
    throw new ContentBriefError(
      "duplicate_outline_sections",
      "The generated outline contains duplicate sections.",
      422,
    );
  }
  const headingSet = new Set(headings);
  const normalizedQuestions = brief.questionsToAnswer.map((question) =>
    normalizedHeading(question.question),
  );
  if (
    new Set(normalizedQuestions).size !== normalizedQuestions.length ||
    brief.questionsToAnswer.some(
      (question) =>
        !headingSet.has(normalizedHeading(question.mappedSectionHeading)),
    ) ||
    brief.externalReferenceRequirements.some(
      (reference) =>
        !headingSet.has(normalizedHeading(reference.intendedSectionHeading)),
    )
  ) {
    throw new ContentBriefError(
      "invalid_brief_mapping",
      "Questions and external references must map to unique existing outline sections.",
      422,
    );
  }
  if (
    brief.outline.length < 3 ||
    brief.outline.length > limits.maximumOutlineSections
  ) {
    throw new ContentBriefError(
      "invalid_outline_length",
      "The generated brief must respect the configured outline-section range.",
      422,
    );
  }

  const claims = new Map(
    snapshot.claims.map((claim) => [claim.researchClaimId, claim]),
  );
  const sources = new Map(
    snapshot.sources.map((source) => [source.noteId, source]),
  );
  const validateReference = (
    reference: Parameters<typeof sourceMatches>[0],
  ) => {
    const allowed = sources.get(reference.noteId);
    if (!allowed || !sourceMatches(reference, allowed, snapshot)) {
      throw new ContentBriefError(
        "fabricated_source_reference",
        "The generated brief referenced a source outside the selected research snapshot.",
        422,
      );
    }
  };

  for (const claim of brief.keyClaims) {
    const allowed = claims.get(claim.researchClaimId);
    if (!allowed || allowed.claim !== claim.claim) {
      throw new ContentBriefError(
        "fabricated_claim_reference",
        "The generated brief referenced an unknown or altered research claim.",
        422,
      );
    }
    for (const reference of claim.sourceReferences) {
      if (
        !allowed.sourceReferences.some((source) =>
          claimSourceMatches(reference, source),
        )
      ) {
        throw new ContentBriefError(
          "fabricated_source_reference",
          "A generated claim was paired with provenance that does not support it.",
          422,
        );
      }
    }
  }
  const includedClaimIds = new Set(
    brief.keyClaims.map((claim) => claim.researchClaimId),
  );
  for (const section of brief.outline) {
    for (const claimId of section.claimReferences) {
      const allowedClaim = claims.get(claimId);
      if (!allowedClaim || !includedClaimIds.has(claimId)) {
        throw new ContentBriefError(
          "fabricated_claim_reference",
          "The generated outline referenced an unknown research claim.",
          422,
        );
      }
      if (
        !section.sourceReferences.some((reference) =>
          allowedClaim.sourceReferences.some((source) =>
            claimSourceMatches(reference, source),
          ),
        )
      ) {
        throw new ContentBriefError(
          "missing_section_provenance",
          "An outline claim is not paired with its supporting source.",
          422,
        );
      }
    }
    section.sourceReferences.forEach(validateReference);
    if (
      section.claimReferences.length > 0 &&
      section.sourceReferences.length === 0
    ) {
      throw new ContentBriefError(
        "missing_section_provenance",
        "A factual outline section did not include source references.",
        422,
      );
    }
    if (
      section.keyPoints.some(
        (point) =>
          point.length > 700 ||
          (point.match(/[.!?](?:\s|$)/gu)?.length ?? 0) > 4,
      )
    ) {
      throw new ContentBriefError(
        "article_prose_detected",
        "The provider returned article-like prose instead of planning points.",
        422,
      );
    }
  }
  for (const requiredSource of brief.requiredSources) {
    validateReference(requiredSource);
    const allowed = sources.get(requiredSource.noteId);
    if (!allowed || requiredSource.sourceQuality !== allowed.sourceQuality) {
      throw new ContentBriefError(
        "fabricated_source_reference",
        "The generated brief altered deterministic source-quality metadata.",
        422,
      );
    }
  }
  brief.externalReferenceRequirements.forEach(validateReference);
  const groundedLists = {
    definitions: new Set(snapshot.notes.flatMap((note) => note.definitions)),
    examples: new Set(snapshot.notes.flatMap((note) => note.examples)),
    statistics: new Set(snapshot.notes.flatMap((note) => note.statistics)),
  };
  for (const [field, allowed] of Object.entries(groundedLists)) {
    const values = brief[field as keyof typeof groundedLists] as string[];
    if (values.some((value) => !allowed.has(value))) {
      throw new ContentBriefError(
        "unsupported_brief_content",
        `The generated brief added an unsupported ${field} value.`,
        422,
      );
    }
  }
  if (
    snapshot.contradictions.length > 0 &&
    (!brief.researchGaps.some(
      (gap) => gap.type === "unresolved_contradiction",
    ) ||
      !brief.draftingInstructions.some((instruction) =>
        /\b(conflict|contradict|disagree|uncertain)/iu.test(instruction),
      ))
  ) {
    throw new ContentBriefError(
      "unrepresented_contradiction",
      "Conflicting research must remain explicit in the brief and drafting instructions.",
      422,
    );
  }
  const checklist = new Set(
    brief.qualityChecklist.map((item) => normalizedHeading(item)),
  );
  if (
    requiredQualityChecklist.some(
      (item) => !checklist.has(normalizedHeading(item)),
    )
  ) {
    throw new ContentBriefError(
      "incomplete_quality_checklist",
      "The generated brief omitted a required drafting-quality check.",
      422,
    );
  }
  if (brief.researchGaps.some((gap) => gap.impact === "major")) {
    throw new ContentBriefError(
      "central_research_gap",
      "A major research gap prevents a valid content brief.",
      422,
    );
  }
  if (snapshot.claims.length > 0 && brief.keyClaims.length === 0) {
    throw new ContentBriefError(
      "missing_validated_claims",
      "The generated brief omitted all available validated claims.",
      422,
    );
  }
  return brief;
}

export { normalizedHeading };
