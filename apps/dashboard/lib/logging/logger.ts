import "server-only";

import { createLogger } from "@ai-publishing-os/shared";

import { getLoggingEnvironment } from "@/lib/env/server";

const globalLogger = globalThis as unknown as {
  applicationLogger?: ReturnType<typeof createLogger>;
};

export function getApplicationLogger() {
  if (!globalLogger.applicationLogger) {
    const environment = getLoggingEnvironment();
    globalLogger.applicationLogger = createLogger({
      level: environment.LOG_LEVEL,
      service: "dashboard",
    });
  }

  return globalLogger.applicationLogger;
}
