import type { PrismaClient } from "@ai-publishing-os/database";
import type { z } from "zod";

import type { internalApiEnvironmentSchema } from "@ai-publishing-os/schemas";

import { PostgresInternalApiRateLimiter } from "./postgres-rate-limit";
import { requireInternalApiRateLimiter } from "./rate-limit";

type InternalApiEnvironment = z.infer<typeof internalApiEnvironmentSchema>;

export async function checkInternalRouteRateLimit(
  database: PrismaClient,
  environment: InternalApiEnvironment,
  scope: string,
) {
  const limiter = requireInternalApiRateLimiter(
    new PostgresInternalApiRateLimiter({
      database,
      limit: environment.INTERNAL_API_RATE_LIMIT_MAX,
      scope,
      windowSeconds: environment.INTERNAL_API_RATE_LIMIT_WINDOW_SECONDS,
    }),
  );
  const result = await limiter.check("configured-internal-api-key");

  return {
    allowed: result.allowed,
    headers: {
      "RateLimit-Limit": result.limit.toString(),
      "RateLimit-Remaining": result.remaining.toString(),
      "RateLimit-Reset": Math.ceil(result.resetAt.getTime() / 1_000).toString(),
      ...(result.allowed
        ? {}
        : {
            "Retry-After": Math.max(
              1,
              Math.ceil((result.resetAt.getTime() - Date.now()) / 1_000),
            ).toString(),
          }),
    },
  };
}
