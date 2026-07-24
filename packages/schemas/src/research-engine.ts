import { z } from "zod";

export const researchLimits = {
  author: 300,
  errorCode: 100,
  errorSummary: 500,
  heading: 300,
  headings: 50,
  listItem: 1_000,
  listItems: 20,
  metadataBytes: 8_192,
  publisher: 300,
  sourceTitle: 300,
  summary: 2_000,
  title: 300,
  url: 2_048,
  workflowExecutionReference: 200,
} as const;

const cuidSchema = z.string().trim().cuid("Must be a valid repository ID");
const boundedListItemSchema = z
  .string()
  .trim()
  .min(1)
  .max(researchLimits.listItem);

export const researchClaimSchema = z.strictObject({
  claim: z.string().trim().min(1).max(1_000),
  confidence: z.enum(["low", "medium", "high"]),
  supportingExcerpt: z.string().trim().min(1).max(500),
});

export const researchProviderOutputSchema = z.strictObject({
  definitions: z.array(boundedListItemSchema).max(researchLimits.listItems),
  examples: z.array(boundedListItemSchema).max(researchLimits.listItems),
  keyClaims: z.array(researchClaimSchema).max(10),
  openQuestions: z.array(boundedListItemSchema).max(researchLimits.listItems),
  risks: z.array(boundedListItemSchema).max(researchLimits.listItems),
  statistics: z.array(boundedListItemSchema).max(researchLimits.listItems),
  summary: z.string().trim().min(1).max(researchLimits.summary),
});

export const researchCreateJobRequestSchema = z.strictObject({
  mode: z.enum(["deterministic", "openai"]).optional(),
  triggerType: z
    .enum(["manual", "internal_api", "n8n"])
    .default("internal_api"),
  workflowExecutionReference: z
    .string()
    .trim()
    .min(1)
    .max(researchLimits.workflowExecutionReference)
    .optional(),
});

export const researchProcessSourceRequestSchema = z.strictObject({
  sourceId: cuidSchema,
});

export const researchCompleteJobRequestSchema = z.strictObject({
  errorCode: z.string().trim().min(1).max(researchLimits.errorCode).optional(),
  errorSummary: z
    .string()
    .trim()
    .min(1)
    .max(researchLimits.errorSummary)
    .optional(),
});

export type ResearchClaim = z.infer<typeof researchClaimSchema>;
export type ResearchProviderOutput = z.infer<
  typeof researchProviderOutputSchema
>;
export type ResearchCreateJobRequest = z.infer<
  typeof researchCreateJobRequestSchema
>;
export type ResearchProcessSourceRequest = z.infer<
  typeof researchProcessSourceRequestSchema
>;
export type ResearchCompleteJobRequest = z.infer<
  typeof researchCompleteJobRequestSchema
>;
