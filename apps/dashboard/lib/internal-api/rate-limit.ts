import "server-only";

export interface InternalApiRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
}

export interface InternalApiRateLimiter {
  check(identifier: string): Promise<InternalApiRateLimitResult>;
}

export function requireInternalApiRateLimiter(
  rateLimiter: InternalApiRateLimiter | undefined,
): InternalApiRateLimiter {
  if (!rateLimiter) {
    throw new Error(
      "An InternalApiRateLimiter must be configured before exposing an internal mutation endpoint.",
    );
  }

  return rateLimiter;
}
