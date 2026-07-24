import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { authOptions } from "@/lib/auth/config";

export default async function LoginPage() {
  const session = await getServerSession(authOptions);

  if (session) {
    redirect("/dashboard");
  }

  const isDevelopmentLoginAvailable = process.env.NODE_ENV === "development";

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="eyebrow">AI Publishing OS</div>
        <h1 id="login-title">Development access</h1>
        <p className="intro">
          Sign in to the local dashboard using the credentials configured in
          your server-only environment.
        </p>

        <div className="warning" role="note">
          <strong>Not production-secure.</strong> This login is only a local
          development convenience. It has no registration, recovery, lockout,
          MFA, or production credential storage.
        </div>

        {isDevelopmentLoginAvailable ? (
          <LoginForm />
        ) : (
          <p className="form-error" role="alert">
            Development credentials are disabled outside development mode.
            Configure an OAuth provider before production deployment.
          </p>
        )}
      </section>
    </main>
  );
}
