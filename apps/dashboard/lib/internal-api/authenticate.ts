import "server-only";

import { getInternalApiEnvironment } from "@/lib/env/server";

import { verifyInternalApiKey } from "./api-key-verifier";

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length);
}

export function authenticateInternalRequest(request: Request): boolean {
  const submittedKey =
    readBearerToken(request) ?? request.headers.get("x-api-key");

  if (!submittedKey) {
    return false;
  }

  const environment = getInternalApiEnvironment();
  return verifyInternalApiKey(submittedKey, environment.INTERNAL_API_KEY);
}
