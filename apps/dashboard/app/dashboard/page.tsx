import { getDatabaseClient } from "@ai-publishing-os/database";

import { SignOutButton } from "@/components/sign-out-button";
import { requireSession } from "@/lib/auth/session";
import { getDatabaseEnvironment } from "@/lib/env/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const environment = getDatabaseEnvironment();
  const database = getDatabaseClient(environment.DATABASE_URL);
  const topics = await database.topic.findMany({
    include: {
      evidence: {
        orderBy: {
          collectedAt: "desc",
        },
        take: 5,
      },
      site: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 50,
  });

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
          Authentication is working. The latest topic-intake records are shown
          below for operational verification.
        </p>
      </section>

      <section className="dashboard-card topic-section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">Topic intake</div>
            <h2>Recent topics</h2>
          </div>
          <span className="count-badge">{topics.length} shown</span>
        </div>

        {topics.length === 0 ? (
          <p className="muted topic-empty">
            No topics have been submitted yet.
          </p>
        ) : (
          <div className="topic-list">
            {topics.map((topic) => (
              <article className="topic-card" key={topic.id}>
                <div className="topic-card-heading">
                  <div>
                    <h3>{topic.title}</h3>
                    <p className="topic-meta">
                      {topic.site.name} · {topic.status.toLowerCase()} ·{" "}
                      {topic.priority.toLowerCase()}
                      {topic.intakeOrigin === "internal_api"
                        ? " · Internal API"
                        : ""}
                    </p>
                  </div>
                  <span className="count-badge">
                    {topic.evidence.length} evidence
                  </span>
                </div>

                {topic.description ? <p>{topic.description}</p> : null}

                {topic.evidence.length > 0 ? (
                  <ul className="evidence-list">
                    {topic.evidence.map((evidence) => (
                      <li key={evidence.id}>
                        <a
                          href={evidence.sourceUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {evidence.sourceTitle ?? evidence.sourceUrl}
                        </a>
                        <span>
                          {evidence.evidenceType.toLowerCase()} ·{" "}
                          {evidence.collectedAt.toISOString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted topic-empty">No evidence attached.</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
