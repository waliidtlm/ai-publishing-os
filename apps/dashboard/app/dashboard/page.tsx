import { SignOutButton } from "@/components/sign-out-button";
import { requireSession } from "@/lib/auth/session";

export default async function DashboardPage() {
  const session = await requireSession();

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">AI Publishing OS</div>
          <h1>Dashboard foundation</h1>
        </div>
        <SignOutButton />
      </header>

      <section className="dashboard-card">
        <h2>Authenticated development session</h2>
        <p>
          Signed in as <strong>{session.user.email}</strong>.
        </p>
        <p className="muted">
          Authentication is working. Publishing features are intentionally
          outside this implementation slice.
        </p>
      </section>
    </main>
  );
}
