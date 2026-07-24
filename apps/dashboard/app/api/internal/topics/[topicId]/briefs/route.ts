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
import { getTopicBriefs } from "@/lib/content-brief/service";

export const dynamic = "force-dynamic";
const topicIdSchema = z.string().cuid();

export async function GET(
  request: Request,
  context: { params: Promise<{ topicId: string }> },
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
    const topicId = topicIdSchema.safeParse((await context.params).topicId);
    if (!topicId.success) {
      return internalErrorResponse(
        400,
        "validation_error",
        "The topic ID is invalid.",
        correlationId,
      );
    }
    const briefs = await getTopicBriefs(
      getDatabaseClient(getDatabaseEnvironment().DATABASE_URL),
      topicId.data,
    );
    return internalJsonResponse(
      { data: briefs, success: true },
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
      "The content briefs could not be read.",
      correlationId,
    );
  }
}
