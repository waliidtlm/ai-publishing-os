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
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;
