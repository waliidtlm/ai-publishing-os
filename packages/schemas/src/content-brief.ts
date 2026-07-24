import { z } from "zod";

export const contentBriefLimits = {
  adjustment: 500,
  alternativeTitles: 5,
  claim: 1_000,
  claims: 50,
  errorSummary: 500,
  instructions: 20,
  keyPointsPerSection: 8,
  listItem: 1_000,
  outlineSections: 12,
  promptCharacters: 120_000,
  questions: 30,
  researchNotes: 20,
  sourceReferences: 20,
  title: 180,
  workflowExecutionReference: 200,
} as const;

export const readerIntentTypeSchema = z.enum([
  "informational",
  "how_to",
  "comparison",
  "decision_support",
  "troubleshooting",
  "transactional",
  "navigational",
  "thought_leadership",
]);

export const articleTypeSchema = z.enum([
  "guide",
  "explainer",
  "tutorial",
  "comparison",
  "checklist",
  "case_study",
  "opinion",
  "reference",
  "troubleshooting",
  "news_analysis",
]);

const boundedText = (maximum: number = contentBriefLimits.listItem) =>
  z.string().trim().min(1).max(maximum);

const httpUrlSchema = z
  .url()
  .max(2_048)
  .refine(
    (value) => {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    },
    { message: "Source URLs must use HTTP or HTTPS" },
  );

const sourceReferenceSchema = z.strictObject({
  evidenceId: z.string().cuid().nullable(),
  noteId: z.string().cuid(),
  sourceTitle: boundedText(300),
  sourceUrl: httpUrlSchema,
  supportingExcerpt: boundedText(500).nullable(),
});

const keyClaimSchema = z.strictObject({
  claim: boundedText(contentBriefLimits.claim),
  researchClaimId: boundedText(250),
  sourceReferences: z
    .array(sourceReferenceSchema)
    .min(1)
    .max(contentBriefLimits.sourceReferences),
});

const outlineSectionSchema = z.strictObject({
  claimReferences: z.array(boundedText(250)).max(contentBriefLimits.claims),
  draftingNotes: z.array(boundedText()).max(5),
  examples: z.array(boundedText()).max(5),
  heading: boundedText(200),
  keyPoints: z
    .array(boundedText())
    .min(1)
    .max(contentBriefLimits.keyPointsPerSection),
  purpose: boundedText(500),
  questionsToAnswer: z.array(boundedText()).max(10),
  sourceReferences: z
    .array(sourceReferenceSchema)
    .max(contentBriefLimits.sourceReferences),
  warnings: z.array(boundedText()).max(5),
});

const questionSchema = z.strictObject({
  mappedSectionHeading: boundedText(200),
  question: boundedText(500),
  status: z.enum(["covered", "partially_covered", "research_gap"]),
});

const researchGapSchema = z.strictObject({
  description: boundedText(500),
  impact: z.enum(["minor", "major"]),
  type: z.enum([
    "unsupported_claim",
    "missing_current_statistic",
    "missing_primary_source",
    "unclear_date",
    "missing_example",
    "unresolved_contradiction",
    "other",
  ]),
});

export const contentBriefProviderOutputSchema = z.strictObject({
  alternativeTitles: z
    .array(boundedText(contentBriefLimits.title))
    .max(contentBriefLimits.alternativeTitles),
  angle: boundedText(1_000),
  articleType: articleTypeSchema,
  definitions: z.array(boundedText()).max(20),
  draftingInstructions: z
    .array(boundedText())
    .min(1)
    .max(contentBriefLimits.instructions),
  estimatedWordCount: z.strictObject({
    maximum: z.number().int().min(300).max(20_000),
    minimum: z.number().int().min(300).max(20_000),
  }),
  examples: z.array(boundedText()).max(20),
  externalReferenceRequirements: z
    .array(
      z.strictObject({
        evidenceId: z.string().cuid().nullable(),
        intendedSectionHeading: boundedText(200),
        noteId: z.string().cuid(),
        reason: boundedText(500),
        sourceTitle: boundedText(300),
        sourceUrl: httpUrlSchema,
      }),
    )
    .max(contentBriefLimits.sourceReferences),
  intent: z.strictObject({
    description: boundedText(1_000),
    desiredOutcome: boundedText(500),
    primaryReaderQuestion: boundedText(500),
    type: readerIntentTypeSchema,
  }),
  internalLinkSuggestions: z
    .array(
      z.strictObject({
        anchorConcept: boundedText(200),
        status: z.literal("unresolved"),
        targetTopic: boundedText(300),
        targetUrl: z.null(),
      }),
    )
    .max(10),
  keyClaims: z.array(keyClaimSchema).max(contentBriefLimits.claims),
  outline: z
    .array(outlineSectionSchema)
    .min(1)
    .max(contentBriefLimits.outlineSections),
  primaryTitle: boundedText(contentBriefLimits.title),
  purpose: boundedText(1_000),
  qualityChecklist: z
    .array(boundedText())
    .min(1)
    .max(contentBriefLimits.instructions),
  questionsToAnswer: z
    .array(questionSchema)
    .min(1)
    .max(contentBriefLimits.questions),
  requiredSources: z
    .array(
      z.strictObject({
        evidenceId: z.string().cuid().nullable(),
        noteId: z.string().cuid(),
        reason: boundedText(500),
        requirement: z.enum(["required", "supporting", "optional"]),
        sourceQuality: z.enum([
          "primary",
          "official",
          "reputable_secondary",
          "community",
          "unknown",
        ]),
        sourceTitle: boundedText(300),
        sourceUrl: httpUrlSchema,
      }),
    )
    .min(1)
    .max(contentBriefLimits.sourceReferences),
  researchGaps: z.array(researchGapSchema).max(20),
  risksAndCaveats: z.array(boundedText()).max(20),
  scope: z.strictObject({
    exclude: z.array(boundedText()).max(20),
    include: z.array(boundedText()).min(1).max(20),
  }),
  statistics: z.array(boundedText()).max(20),
  targetAudience: z.strictObject({
    context: boundedText(500),
    description: boundedText(500),
    desiredOutcome: boundedText(500),
    inferred: z.boolean(),
    knowledgeLevel: z.enum(["beginner", "intermediate", "advanced", "mixed"]),
    objectionsOrMisconceptions: z.array(boundedText()).max(10),
    problem: boundedText(500),
  }),
  targetDepth: z.enum(["concise", "standard", "comprehensive"]),
  tone: boundedText(100),
});

export const contentBriefAdjustmentSchema = z.strictObject({
  angle: boundedText(contentBriefLimits.adjustment).optional(),
  articleType: articleTypeSchema.optional(),
  emphasize: boundedText(contentBriefLimits.adjustment).optional(),
  excludeSections: z.array(boundedText(200)).max(5).optional(),
  outlinePreference: z.enum(["shorter", "expanded"]).optional(),
  targetAudience: boundedText(contentBriefLimits.adjustment).optional(),
});

export const contentBriefCreateJobRequestSchema = z.strictObject({
  adjustment: contentBriefAdjustmentSchema.optional(),
  forceRegeneration: z.boolean().default(false),
  mode: z.enum(["deterministic", "openai"]).optional(),
  regenerationReason: boundedText(500).optional(),
  triggerType: z
    .enum(["manual", "internal_api", "n8n"])
    .default("internal_api"),
  workflowExecutionReference: boundedText(
    contentBriefLimits.workflowExecutionReference,
  ).optional(),
});

export const contentBriefGenerateRequestSchema = z.strictObject({});

export type ContentBriefAdjustment = z.infer<
  typeof contentBriefAdjustmentSchema
>;
export type ContentBriefCreateJobRequest = z.infer<
  typeof contentBriefCreateJobRequestSchema
>;
export type ContentBriefProviderOutput = z.infer<
  typeof contentBriefProviderOutputSchema
>;
