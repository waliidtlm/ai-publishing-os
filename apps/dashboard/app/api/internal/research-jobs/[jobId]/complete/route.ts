import { getDatabaseClient } from "@ai-publishing-os/database";
import { researchCompleteJobRequestSchema } from "@ai-publishing-os/schemas";
import { z } from "zod";

import {
  getDatabaseEnvironment,
  getInternalApiEnvironment,
} from "@/lib/env/server";
import { authenticateInternalRequest } from "@/lib/internal-api/authenticate";
import {
  correlationIdFor,
  internalErrorResponse,
  internalJsonResponse,
} from "@/lib/internal-api/response";
import { checkInternalRouteRateLimit } from "@/lib/internal-api/route-rate-limit";
import { getApplicationLogger } from "@/lib/logging/logger";
import { ResearchError } from "@/lib/research/errors";
import { completeResearchJob } from "@/lib/research/service";

export const dynamic = "force-dynamic";

const jobIdSchema = z.string().cuid();

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const correlationId = correlationIdFor(request);
  const logger = getApplicationLogger().child({
    correlationId,
    route: "POST /api/internal/research-jobs/:jobId/complete",
  });

  try {
    if (!authenticateInternalRequest(request)) {
      return internalErrorResponse(
        401,
        "unauthorized",
        "Valid internal authentication is required.",
        correlationId,
      );
    }

    const { jobId: rawJobId } = await context.params;
    const jobId = jobIdSchema.safeParse(rawJobId);

    if (!jobId.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The research job ID is invalid.",
        correlationId,
      );
    }

    const requestText = await request.text();
    let body: unknown = {};

    if (requestText.trim()) {
      try {
        body = JSON.parse(requestText);
      } catch {
        return internalErrorResponse(
          400,
          "malformed_json",
          "The request body must be valid JSON.",
          correlationId,
        );
      }
    }

    const parsed = researchCompleteJobRequestSchema.safeParse(body);

    if (!parsed.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The complete-job request failed validation.",
        correlationId,
      );
    }

    const database = getDatabaseClient(getDatabaseEnvironment().DATABASE_URL);
    const rateLimit = await checkInternalRouteRateLimit(
      database,
      getInternalApiEnvironment(),
      "research-job-complete",
    );

    if (!rateLimit.allowed) {
      return internalErrorResponse(
        429,
        "rate_limited",
        "The research completion rate limit was exceeded.",
        correlationId,
        { additionalHeaders: rateLimit.headers, retryable: true },
      );
    }

    const job = await completeResearchJob({
      correlationId,
      database,
      request: parsed.data,
      researchJobId: jobId.data,
    });

    return internalJsonResponse(
      { data: job, success: true },
      200,
      correlationId,
      rateLimit.headers,
    );
  } catch (error) {
    if (error instanceof ResearchError) {
      return internalErrorResponse(
        error.httpStatus,
        error.code,
        error.message,
        correlationId,
        { retryable: error.retryable },
      );
    }

    logger.error({ err: error }, "Research job completion failed");
    return internalErrorResponse(
      500,
      "internal_error",
      "The research job could not be completed.",
      correlationId,
    );
  }
}
