import { resolve } from "node:path";

import {
  developmentAuthEnvironmentSchema,
  serverEnvironmentSchema,
} from "@ai-publishing-os/schemas";
import { config } from "dotenv";
import { ZodError } from "zod";

config({
  path: resolve(process.cwd(), "apps/dashboard/.env.local"),
});

try {
  serverEnvironmentSchema.parse(process.env);

  if ((process.env.NODE_ENV ?? "development") === "development") {
    developmentAuthEnvironmentSchema.parse(process.env);
  }

  process.stdout.write(
    `${JSON.stringify({
      environment: process.env.NODE_ENV ?? "development",
      status: "valid",
    })}\n`,
  );
} catch (error) {
  if (error instanceof ZodError) {
    process.stderr.write(
      `${JSON.stringify({
        issues: error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.join("."),
        })),
        status: "invalid",
      })}\n`,
    );
    process.exitCode = 1;
  } else {
    throw error;
  }
}
