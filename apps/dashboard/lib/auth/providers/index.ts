import "server-only";

import type { NextAuthOptions } from "next-auth";

import { createDevelopmentCredentialsProvider } from "./development-credentials";

export function getAuthProviders(): NextAuthOptions["providers"] {
  if (process.env.NODE_ENV !== "development") {
    return [];
  }

  return [createDevelopmentCredentialsProvider()];
}
