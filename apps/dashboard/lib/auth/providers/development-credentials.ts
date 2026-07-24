import "server-only";

import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";

import { verifyDevelopmentCredentials } from "@/lib/auth/credentials-verifier";
import { getDevelopmentAuthEnv } from "@/lib/env/auth";

const submittedCredentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(256),
});

export function createDevelopmentCredentialsProvider() {
  const env = getDevelopmentAuthEnv();

  return CredentialsProvider({
    id: "development-credentials",
    name: "Development credentials",
    credentials: {
      email: {
        label: "Email",
        type: "email",
        placeholder: "developer@example.com",
      },
      password: {
        label: "Password",
        type: "password",
      },
    },
    async authorize(credentials) {
      const parsed = submittedCredentialsSchema.safeParse(credentials);

      if (!parsed.success) {
        return null;
      }

      const isValid = verifyDevelopmentCredentials(parsed.data, {
        email: env.DEV_AUTH_EMAIL,
        password: env.DEV_AUTH_PASSWORD,
      });

      if (!isValid) {
        return null;
      }

      return {
        id: "development-user",
        email: env.DEV_AUTH_EMAIL,
        name: env.DEV_AUTH_NAME,
      };
    },
  });
}
