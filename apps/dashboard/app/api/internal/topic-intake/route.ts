import { randomUUID } from "node:crypto";

import { getDatabaseClient } from "@ai-publishing-os/database";
import { topicIntakeRequestSchema } from "@ai-publishing-os/schemas";
import { NextResponse } from "next/server";

import {
  getDatabaseEnvironment,
  getInternalApiEnvironment,
} from "@/lib/env/server";
import { authenticateInternalRequest } from "@/lib/internal-api/authenticate";
import { PostgresInternalApiRateLimiter } from "@/lib/internal-api/postgres-rate-limit";
import { requireInternalApiRateLimiter } from "@/lib/internal-api/rate-limit";
import { getApplicationLogger } from "@/lib/logging/logger";
import {
  IdempotencyConflictError,
  InactiveSourceConfigurationError,
  IntakeResourceNotFoundError,
} from "@/lib/topic-intake/errors";
import { createTopicIntakeSuccessResponse } from "@/lib/topic-intake/result";
import { processTopicIntake } from "@/lib/topic-intake/service";

export const dynamic = "force-dynamic";

interface ApiErrorResponse {
  error: {
    code: string;
    fields?: Array<{
      message: string;
      path: string;
    }>;
    message: string;
  };
  success: false;
}

function correlationIdFor(request: Request): string {
  const supplied = request.headers.get("x-request-id");

  if (supplied && /^[A-Za-z0-9._-]{1,100}$/u.test(supplied)) {
    return supplied;
  }

  return randomUUID();
}

function jsonResponse(
  body: ApiErrorResponse | ReturnType<typeof createTopicIntakeSuccessResponse>,
  status: number,
  correlationId: string,
  additionalHeaders: HeadersInit = {},
) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store",
      "X-Request-Id": correlationId,
      ...additionalHeaders,
    },
    status,
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  correlationId: string,
  fields?: ApiErrorResponse["error"]["fields"],
  additionalHeaders?: HeadersInit,
) {
  return jsonResponse(
    {
      error: {
        code,
        ...(fields ? { fields } : {}),
        message,
      },
      success: false,
    },
    status,
    correlationId,
    additionalHeaders,
  );
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  const correlationId = correlationIdFor(request);
  const logger = getApplicationLogger().child({
    correlationId,
    route: "POST /api/internal/topic-intake",
  });

  try {
    if (!authenticateInternalRequest(request)) {
      logger.warn(
        {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: "authentication_failed",
        },
        "Topic intake request rejected",
      );

      return errorResponse(
        401,
        "unauthorized",
        "Valid internal authentication is required.",
        correlationId,
      );
    }

    const databaseEnvironment = getDatabaseEnvironment();
    const internalApiEnvironment = getInternalApiEnvironment();
    const database = getDatabaseClient(databaseEnvironment.DATABASE_URL);
    const rateLimiter = requireInternalApiRateLimiter(
      new PostgresInternalApiRateLimiter({
        database,
        limit: internalApiEnvironment.INTERNAL_API_RATE_LIMIT_MAX,
        scope: "topic-intake",
        windowSeconds:
          internalApiEnvironment.INTERNAL_API_RATE_LIMIT_WINDOW_SECONDS,
      }),
    );
    const rateLimit = await rateLimiter.check("configured-internal-api-key");
    const rateLimitHeaders = {
      "RateLimit-Limit": rateLimit.limit.toString(),
      "RateLimit-Remaining": rateLimit.remaining.toString(),
      "RateLimit-Reset": Math.ceil(
        rateLimit.resetAt.getTime() / 1_000,
      ).toString(),
    };

    if (!rateLimit.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1_000),
      );

      logger.warn(
        {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: "rate_limited",
        },
        "Topic intake request rate limited",
      );

      return errorResponse(
        429,
        "rate_limited",
        "The internal topic intake rate limit was exceeded.",
        correlationId,
        undefined,
        {
          ...rateLimitHeaders,
          "Retry-After": retryAfter.toString(),
        },
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return errorResponse(
        400,
        "malformed_json",
        "The request body must be valid JSON.",
        correlationId,
        undefined,
        rateLimitHeaders,
      );
    }

    const parsed = topicIntakeRequestSchema.safeParse(body);

    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.join(".") || "$",
      }));

      logger.info(
        {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: "validation_failed",
          validationPaths: fields.map((field) => field.path),
        },
        "Topic intake validation failed",
      );

      return errorResponse(
        400,
        "validation_error",
        "The request body failed validation.",
        correlationId,
        fields,
        rateLimitHeaders,
      );
    }

    const processed = await processTopicIntake({
      correlationId,
      database,
      request: parsed.data,
    });
    const durationMs = Math.round(performance.now() - startedAt);

    logger.info(
      {
        durationMs,
        evidenceId: processed.result.evidenceId,
        outcome: processed.result.idempotentReplay
          ? "idempotent_replay"
          : processed.result.topicCreated
            ? "topic_created"
            : "topic_matched",
        siteId: parsed.data.siteId,
        topicId: processed.result.topicId,
      },
      "Topic intake request completed",
    );

    return jsonResponse(
      createTopicIntakeSuccessResponse(processed.result),
      processed.httpStatus,
      correlationId,
      rateLimitHeaders,
    );
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);

    if (error instanceof IdempotencyConflictError) {
      logger.info(
        {
          durationMs,
          outcome: "idempotency_conflict",
        },
        "Topic intake idempotency conflict",
      );

      return errorResponse(
        409,
        "idempotency_conflict",
        error.message,
        correlationId,
      );
    }

    if (error instanceof IntakeResourceNotFoundError) {
      logger.info(
        {
          durationMs,
          outcome: error.code,
        },
        "Topic intake reference was not found",
      );

      return errorResponse(404, error.code, error.message, correlationId);
    }

    if (error instanceof InactiveSourceConfigurationError) {
      logger.info(
        {
          durationMs,
          outcome: "inactive_source_configuration",
        },
        "Topic intake source configuration is inactive",
      );

      return errorResponse(
        422,
        "inactive_source_configuration",
        error.message,
        correlationId,
      );
    }

    logger.error(
      {
        durationMs,
        err: error,
        outcome: "unexpected_error",
      },
      "Topic intake request failed",
    );

    return errorResponse(
      500,
      "internal_error",
      "The topic intake request could not be completed.",
      correlationId,
    );
  }
}
