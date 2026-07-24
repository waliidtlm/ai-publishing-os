import { checkDatabaseConnection } from "@ai-publishing-os/database";
import { NextResponse } from "next/server";

import { getDatabaseEnvironment } from "@/lib/env/server";
import { getApplicationLogger } from "@/lib/logging/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = performance.now();
  const logger = getApplicationLogger();

  try {
    const environment = getDatabaseEnvironment();
    await checkDatabaseConnection(environment.DATABASE_URL);

    const durationMs = Math.round(performance.now() - startedAt);
    logger.debug({ durationMs }, "Database readiness check passed");

    return NextResponse.json(
      {
        database: "reachable",
        durationMs,
        service: "dashboard",
        status: "ok",
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    logger.error({ durationMs, err: error }, "Database readiness check failed");

    return NextResponse.json(
      {
        database: "unreachable",
        durationMs,
        service: "dashboard",
        status: "unavailable",
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
        status: 503,
      },
    );
  }
}
