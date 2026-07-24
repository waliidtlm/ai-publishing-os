import { getDatabaseClient } from "@ai-publishing-os/database";
import { z } from "zod";

import { getDatabaseEnvironment } from "@/lib/env/server";
import { authenticateInternalRequest } from "@/lib/internal-api/authenticate";
import {
  correlationIdFor,
  internalErrorResponse,
  internalJsonResponse,
} from "@/lib/internal-api/response";
import { ContentBriefError } from "@/lib/content-brief/errors";
import { getBriefGenerationJob } from "@/lib/content-brief/service";

export const dynamic = "force-dynamic";
const jobIdSchema = z.string().cuid();

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const correlationId = correlationIdFor(request);
  try {
    if (!authenticateInternalRequest(request)) {
      return internalErrorResponse(
        401,
        "unauthorized",
        "Valid internal authentication is required.",
        correlationId,
      );
    }
    const jobId = jobIdSchema.safeParse((await context.params).jobId);
    if (!jobId.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The brief job ID is invalid.",
        correlationId,
      );
    }
    const job = await getBriefGenerationJob(
      getDatabaseClient(getDatabaseEnvironment().DATABASE_URL),
      jobId.data,
    );
    return internalJsonResponse(
      { data: job, success: true },
      200,
      correlationId,
    );
  } catch (error) {
    if (error instanceof ContentBriefError) {
      return internalErrorResponse(
        error.httpStatus,
        error.code,
        error.message,
        correlationId,
      );
    }
    return internalErrorResponse(
      500,
      "internal_error",
      "The brief job could not be read.",
      correlationId,
    );
  }
}
