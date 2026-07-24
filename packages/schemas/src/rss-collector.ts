import { z } from "zod";

export const rssCollectorLimits = {
  author: 300,
  errorCode: 100,
  errorSummary: 500,
  etag: 1_024,
  excerpt: 1_000,
  feedTitle: 300,
  lastModified: 200,
  metadataBytes: 4_096,
  stableId: 100,
  title: 200,
  url: 2_048,
  workflowExecutionId: 200,
} as const;

const cuidSchema = z.string().trim().cuid("Must be a valid repository ID");
const optionalTimestampSchema = z.iso.datetime({ offset: true }).optional();
const countSchema = z.number().int().min(0).max(1_000_000);

export const rssSourceListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const rssFetchRequestSchema = z.strictObject({
  entryLimit: z.number().int().min(1).max(100).optional(),
});

export const rssCollectionStartedSchema = z.strictObject({
  startedAt: optionalTimestampSchema,
  status: z.literal("started"),
  workflowExecutionId: z
    .string()
    .trim()
    .min(1)
    .max(rssCollectorLimits.workflowExecutionId)
    .optional(),
});

export const rssCollectionCompletedSchema = z
  .strictObject({
    acceptedCount: countSchema,
    completedAt: optionalTimestampSchema,
    discoveredCount: countSchema,
    durationMs: z.number().int().min(0).max(86_400_000),
    errorCode: z
      .string()
      .trim()
      .min(1)
      .max(rssCollectorLimits.errorCode)
      .optional(),
    errorSummary: z
      .string()
      .trim()
      .min(1)
      .max(rssCollectorLimits.errorSummary)
      .optional(),
    etag: z.string().trim().min(1).max(rssCollectorLimits.etag).optional(),
    failedCount: countSchema,
    httpStatus: z.number().int().min(100).max(599).optional(),
    lastModified: z
      .string()
      .trim()
      .min(1)
      .max(rssCollectorLimits.lastModified)
      .optional(),
    matchedCount: countSchema,
    returnedCount: countSchema,
    runId: cuidSchema,
    skippedCount: countSchema,
    status: z.enum(["succeeded", "partial", "failed", "not_modified"]),
    submittedCount: countSchema,
  })
  .superRefine((value, context) => {
    if (value.returnedCount > value.discoveredCount) {
      context.addIssue({
        code: "custom",
        message: "returnedCount cannot exceed discoveredCount",
        path: ["returnedCount"],
      });
    }

    if (value.submittedCount > value.returnedCount) {
      context.addIssue({
        code: "custom",
        message: "submittedCount cannot exceed returnedCount",
        path: ["submittedCount"],
      });
    }

    if (value.acceptedCount + value.failedCount > value.submittedCount) {
      context.addIssue({
        code: "custom",
        message: "acceptedCount plus failedCount cannot exceed submittedCount",
        path: ["acceptedCount"],
      });
    }

    if (value.matchedCount > value.acceptedCount) {
      context.addIssue({
        code: "custom",
        message: "matchedCount cannot exceed acceptedCount",
        path: ["matchedCount"],
      });
    }

    if (value.status === "failed" && !value.errorCode) {
      context.addIssue({
        code: "custom",
        message: "errorCode is required for failed collections",
        path: ["errorCode"],
      });
    }
  });

export const rssCollectionResultSchema = z.discriminatedUnion("status", [
  rssCollectionStartedSchema,
  rssCollectionCompletedSchema,
]);

export type RssCollectionResultRequest = z.infer<
  typeof rssCollectionResultSchema
>;
export type RssCollectionCompletedRequest = z.infer<
  typeof rssCollectionCompletedSchema
>;
