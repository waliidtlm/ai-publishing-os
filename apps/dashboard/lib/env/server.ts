import "server-only";

import {
  databaseEnvironmentSchema,
  internalApiEnvironmentSchema,
  loggingEnvironmentSchema,
} from "@ai-publishing-os/schemas";

export function getDatabaseEnvironment() {
  return databaseEnvironmentSchema.parse(process.env);
}

export function getInternalApiEnvironment() {
  return internalApiEnvironmentSchema.parse(process.env);
}

export function getLoggingEnvironment() {
  return loggingEnvironmentSchema.parse(process.env);
}
