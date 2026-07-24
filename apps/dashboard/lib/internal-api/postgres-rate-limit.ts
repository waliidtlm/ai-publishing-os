import { createHash } from "node:crypto";

import type { PrismaClient } from "@ai-publishing-os/database";

import type {
  InternalApiRateLimiter,
  InternalApiRateLimitResult,
} from "./rate-limit";

export interface PostgresRateLimiterOptions {
  database: PrismaClient;
  limit: number;
  scope: string;
  windowSeconds: number;
}

function identifierHash(identifier: string): string {
  return createHash("sha256").update(identifier, "utf8").digest("hex");
}

export class PostgresInternalApiRateLimiter implements InternalApiRateLimiter {
  constructor(private readonly options: PostgresRateLimiterOptions) {}

  async check(identifier: string): Promise<InternalApiRateLimitResult> {
    const now = Date.now();
    const windowMilliseconds = this.options.windowSeconds * 1_000;
    const windowStart = new Date(
      Math.floor(now / windowMilliseconds) * windowMilliseconds,
    );
    const resetAt = new Date(windowStart.getTime() + windowMilliseconds);
    const bucketIdentifierHash = identifierHash(identifier);
    const retentionBoundary = new Date(now - 24 * 60 * 60 * 1_000);

    const [, bucket] = await this.options.database.$transaction([
      this.options.database.internalApiRateLimitBucket.deleteMany({
        where: {
          windowStart: {
            lt: retentionBoundary,
          },
        },
      }),
      this.options.database.internalApiRateLimitBucket.upsert({
        create: {
          identifierHash: bucketIdentifierHash,
          requestCount: 1,
          scope: this.options.scope,
          windowStart,
        },
        update: {
          requestCount: {
            increment: 1,
          },
        },
        where: {
          scope_identifierHash_windowStart: {
            identifierHash: bucketIdentifierHash,
            scope: this.options.scope,
            windowStart,
          },
        },
      }),
    ]);

    return {
      allowed: bucket.requestCount <= this.options.limit,
      limit: this.options.limit,
      remaining: Math.max(0, this.options.limit - bucket.requestCount),
      resetAt,
    };
  }
}
