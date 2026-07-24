import { z } from "zod";

const postgresUrlSchema = z
  .url()
  .refine(
    (value) =>
      value.startsWith("postgresql://") || value.startsWith("postgres://"),
    "Must be a PostgreSQL connection URL",
  );

export const databaseEnvironmentSchema = z.object({
  DATABASE_URL: postgresUrlSchema,
  TEST_DATABASE_URL: postgresUrlSchema.optional(),
});

export const internalApiEnvironmentSchema = z.object({
  INTERNAL_API_KEY: z.string().min(32).max(512),
  INTERNAL_API_RATE_LIMIT_MAX: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(60),
  INTERNAL_API_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3_600)
    .default(60),
});

export const loggingEnvironmentSchema = z.object({
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export const rssCollectorEnvironmentSchema = z.object({
  RSS_MAX_ENTRIES_PER_SOURCE: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20),
  RSS_MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(3),
  RSS_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(16_384)
    .max(10_485_760)
    .default(1_048_576),
  RSS_MAX_SOURCES_PER_RUN: z.coerce.number().int().min(1).max(100).default(25),
  RSS_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(10_000),
});

const booleanEnvironmentValue = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

export const researchEnvironmentSchema = z
  .object({
    AI_API_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(20).max(512).optional(),
    ),
    AI_MODEL_RESEARCH: z.string().trim().min(1).max(100).default("gpt-5-mini"),
    AI_PROVIDER: z.enum(["openai"]).default("openai"),
    RESEARCH_AI_ENABLED: booleanEnvironmentValue,
    RESEARCH_ALLOW_DETERMINISTIC_FALLBACK: booleanEnvironmentValue,
    RESEARCH_DEFAULT_MODE: z
      .enum(["deterministic", "openai"])
      .default("deterministic"),
    RESEARCH_MAX_CLAIMS_PER_SOURCE: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10),
    RESEARCH_MAX_CONCURRENT_AI_PER_SITE: z.coerce
      .number()
      .int()
      .min(1)
      .max(5)
      .default(1),
    RESEARCH_MAX_CONCURRENT_FETCHES: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(2),
    RESEARCH_MAX_EXCERPT_CHARS: z.coerce
      .number()
      .int()
      .min(100)
      .max(2_000)
      .default(500),
    RESEARCH_MAX_INPUT_CHARS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(200_000)
      .default(100_000),
    RESEARCH_MAX_NOTES_PER_JOB: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5),
    RESEARCH_MAX_OUTPUT_TOKENS: z.coerce
      .number()
      .int()
      .min(256)
      .max(16_384)
      .default(2_500),
    RESEARCH_MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(3),
    RESEARCH_MAX_RESPONSE_BYTES: z.coerce
      .number()
      .int()
      .min(16_384)
      .max(10_485_760)
      .default(2_097_152),
    RESEARCH_MAX_SOURCES_PER_JOB: z.coerce
      .number()
      .int()
      .min(1)
      .max(25)
      .default(10),
    RESEARCH_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(60_000)
      .default(15_000),
  })
  .superRefine((value, context) => {
    if (
      value.RESEARCH_DEFAULT_MODE === "openai" &&
      value.RESEARCH_AI_ENABLED &&
      !value.AI_API_KEY &&
      !value.RESEARCH_ALLOW_DETERMINISTIC_FALLBACK
    ) {
      context.addIssue({
        code: "custom",
        message:
          "AI_API_KEY is required for OpenAI mode unless deterministic fallback is explicitly enabled",
        path: ["AI_API_KEY"],
      });
    }
  });

export const authEnvironmentSchema = z.object({
  NEXTAUTH_SECRET: z.string().min(32),
  NEXTAUTH_URL: z.url().optional(),
});

export const developmentAuthEnvironmentSchema = z.object({
  DEV_AUTH_EMAIL: z.email(),
  DEV_AUTH_PASSWORD: z.string().min(12).max(256),
  DEV_AUTH_NAME: z.string().trim().min(1).max(100).default("Local Developer"),
});

export const serverEnvironmentSchema = databaseEnvironmentSchema
  .and(internalApiEnvironmentSchema)
  .and(loggingEnvironmentSchema)
  .and(authEnvironmentSchema);

export type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;
export type DevelopmentAuthEnvironment = z.infer<
  typeof developmentAuthEnvironmentSchema
>;
export type LoggingEnvironment = z.infer<typeof loggingEnvironmentSchema>;
export type ResearchEnvironment = z.infer<typeof researchEnvironmentSchema>;
export type RssCollectorEnvironment = z.infer<
  typeof rssCollectorEnvironmentSchema
>;
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;
