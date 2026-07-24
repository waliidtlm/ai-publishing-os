import "server-only";

import {
  authEnvironmentSchema,
  developmentAuthEnvironmentSchema,
  type DevelopmentAuthEnvironment,
} from "@ai-publishing-os/schemas";

export function getAuthSecret(): string {
  return authEnvironmentSchema.parse(process.env).NEXTAUTH_SECRET;
}

export function getDevelopmentAuthEnv(): DevelopmentAuthEnvironment {
  if (process.env.NODE_ENV !== "development") {
    throw new Error(
      "Development credentials were requested outside development mode.",
    );
  }

  return developmentAuthEnvironmentSchema.parse(process.env);
}
