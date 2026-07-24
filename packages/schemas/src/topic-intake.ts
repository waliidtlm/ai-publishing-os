import { z } from "zod";

export const topicIntakeLimits = {
  description: 2_000,
  excerpt: 5_000,
  externalId: 300,
  idempotencyKey: 200,
  metadataBytes: 16_384,
  sourceTitle: 300,
  sourceUrl: 2_048,
  title: 200,
} as const;

const cuidSchema = z.string().trim().cuid("Must be a valid repository ID");

const metadataSchema = z
  .record(z.string(), z.json())
  .refine(
    (value) => JSON.stringify(value).length <= topicIntakeLimits.metadataBytes,
    `Metadata must not exceed ${topicIntakeLimits.metadataBytes} bytes`,
  );

const httpUrlSchema = z
  .string()
  .trim()
  .max(topicIntakeLimits.sourceUrl)
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Must use the HTTP or HTTPS protocol");

export const intakeEvidenceTypes = [
  "manual",
  "source",
  "trend",
  "keyword",
  "competitor",
  "performance",
] as const;

export const topicIntakeSourceSchema = z.strictObject({
  collectedAt: z.iso.datetime({ offset: true }).optional(),
  evidenceType: z.enum(intakeEvidenceTypes),
  excerpt: z.string().trim().max(topicIntakeLimits.excerpt).optional(),
  metadata: metadataSchema.optional(),
  sourceConfigId: cuidSchema.optional(),
  sourceTitle: z
    .string()
    .trim()
    .min(1)
    .max(topicIntakeLimits.sourceTitle)
    .optional(),
  sourceUrl: httpUrlSchema,
});

export const topicIntakeRequestSchema = z.strictObject({
  description: z
    .string()
    .trim()
    .min(1)
    .max(topicIntakeLimits.description)
    .optional(),
  externalId: z
    .string()
    .trim()
    .min(1)
    .max(topicIntakeLimits.externalId)
    .optional(),
  idempotencyKey: z
    .string()
    .trim()
    .min(1)
    .max(topicIntakeLimits.idempotencyKey),
  metadata: metadataSchema.optional(),
  siteId: cuidSchema,
  source: topicIntakeSourceSchema.optional(),
  title: z.string().trim().min(1).max(topicIntakeLimits.title),
});

export type TopicIntakeRequest = z.infer<typeof topicIntakeRequestSchema>;
