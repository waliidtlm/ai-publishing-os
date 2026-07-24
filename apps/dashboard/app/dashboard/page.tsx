import { getDatabaseClient } from "@ai-publishing-os/database";

import { SignOutButton } from "@/components/sign-out-button";
import { requireSession } from "@/lib/auth/session";
import { getDatabaseEnvironment } from "@/lib/env/server";

export const dynamic = "force-dynamic";

function formatTimestamp(value: Date | null): string {
  return value ? value.toISOString() : "Never";
}

export default async function DashboardPage() {
  const session = await requireSession();
  const environment = getDatabaseEnvironment();
  const database = getDatabaseClient(environment.DATABASE_URL);
  const [topics, rssSources] = await Promise.all([
    database.topic.findMany({
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
    }),
    database.sourceConfig.findMany({
      include: {
        rssCollectionRuns: {
          orderBy: {
            startedAt: "desc",
          },
          take: 1,
        },
        site: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
      where: {
        sourceType: "RSS",
      },
    }),
  ]);

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
          Authentication is working. RSS collection status and the latest
          topic-intake records are shown below for operational verification.
        </p>
      </section>

      <section className="dashboard-card rss-section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">RSS collector</div>
            <h2>Configured feeds</h2>
          </div>
          <span className="count-badge">{rssSources.length} sources</span>
        </div>

        {rssSources.length === 0 ? (
          <p className="muted topic-empty">
            No RSS source configurations exist yet.
          </p>
        ) : (
          <div className="source-list">
            {rssSources.map((source) => {
              const latestRun = source.rssCollectionRuns[0];

              return (
                <article className="source-card" key={source.id}>
                  <div className="topic-card-heading">
                    <div>
                      <h3>{source.name}</h3>
                      <p className="topic-meta">
                        {source.site.name} {" · "}
                        {source.isActive ? "active" : "inactive"}
                      </p>
                    </div>
                    <span
                      className={
                        source.isActive
                          ? "count-badge"
                          : "count-badge count-badge-muted"
                      }
                    >
                      {latestRun?.status.toLowerCase() ?? "not collected"}
                    </span>
                  </div>

                  {source.baseUrl ? (
                    <a
                      className="source-url"
                      href={source.baseUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {source.baseUrl}
                    </a>
                  ) : (
                    <p className="source-error">Feed URL is missing.</p>
                  )}

                  <dl className="source-metrics">
                    <div>
                      <dt>Last attempt</dt>
                      <dd>{formatTimestamp(source.lastCollectedAt)}</dd>
                    </div>
                    <div>
                      <dt>Last success</dt>
                      <dd>
                        {formatTimestamp(source.lastSuccessfulCollectedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt>Latest counts</dt>
                      <dd>
                        {latestRun
                          ? `${latestRun.acceptedCount} accepted, ${latestRun.matchedCount} matched, ${latestRun.skippedCount} skipped, ${latestRun.failedCount} failed`
                          : "No run recorded"}
                      </dd>
                    </div>
                  </dl>

                  {source.lastErrorSummary ? (
                    <p className="source-error">
                      Latest error: {source.lastErrorSummary}
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
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
                      {topic.site.name} {" · "} {topic.status.toLowerCase()}{" "}
                      {" · "} {topic.priority.toLowerCase()}
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
                          {evidence.evidenceType.toLowerCase()} {" · "}
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
