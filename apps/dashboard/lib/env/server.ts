import "server-only";

import {
  databaseEnvironmentSchema,
  internalApiEnvironmentSchema,
  loggingEnvironmentSchema,
  rssCollectorEnvironmentSchema,
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

export function getRssCollectorEnvironment() {
  return rssCollectorEnvironmentSchema.parse(process.env);
}
