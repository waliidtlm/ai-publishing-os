import "server-only";

import type { NextAuthOptions } from "next-auth";

import { getAuthSecret } from "@/lib/env/auth";

import { getAuthProviders } from "./providers";

export const authOptions = {
  secret: getAuthSecret(),
  providers: getAuthProviders(),
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }

      return session;
    },
  },
} satisfies NextAuthOptions;
