import "server-only";

import {
  contentBriefEnvironmentSchema,
  databaseEnvironmentSchema,
  internalApiEnvironmentSchema,
  loggingEnvironmentSchema,
  researchEnvironmentSchema,
  rssCollectorEnvironmentSchema,
} from "@ai-publishing-os/schemas";

export function getContentBriefEnvironment() {
  return contentBriefEnvironmentSchema.parse(process.env);
}

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

export function getResearchEnvironment() {
  return researchEnvironmentSchema.parse(process.env);
}
