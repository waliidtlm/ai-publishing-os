import { getDatabaseClient } from "@ai-publishing-os/database";

import { SignOutButton } from "@/components/sign-out-button";
import { requireSession } from "@/lib/auth/session";
import { getDatabaseEnvironment } from "@/lib/env/server";

export const dynamic = "force-dynamic";

function formatTimestamp(value: Date | null): string {
  return value ? value.toISOString() : "Never";
}

interface DisplayClaim {
  claim: string;
  confidence: string;
  evidenceId: string | null;
  supportingExcerpt: string;
}

function claimsForDisplay(value: unknown): DisplayClaim[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((claim) => {
    if (
      typeof claim !== "object" ||
      claim === null ||
      !("claim" in claim) ||
      !("supportingExcerpt" in claim) ||
      typeof claim.claim !== "string" ||
      typeof claim.supportingExcerpt !== "string"
    ) {
      return [];
    }

    return [
      {
        claim: claim.claim,
        confidence:
          "confidence" in claim && typeof claim.confidence === "string"
            ? claim.confidence
            : "unknown",
        evidenceId:
          "evidenceId" in claim && typeof claim.evidenceId === "string"
            ? claim.evidenceId
            : null,
        supportingExcerpt: claim.supportingExcerpt,
      },
    ];
  });
}

function stringsForDisplay(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

interface BriefSectionDisplay {
  heading: string;
  keyPoints: string[];
  sourceReferences: Array<{
    sourceTitle: string;
    sourceUrl: string;
  }>;
}

function briefSectionsForDisplay(value: unknown): BriefSectionDisplay[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((section) => {
    if (
      !section ||
      typeof section !== "object" ||
      !("heading" in section) ||
      typeof section.heading !== "string"
    ) {
      return [];
    }
    const sourceReferences =
      "sourceReferences" in section && Array.isArray(section.sourceReferences)
        ? section.sourceReferences.flatMap((source: unknown) =>
            source &&
            typeof source === "object" &&
            "sourceTitle" in source &&
            "sourceUrl" in source &&
            typeof source.sourceTitle === "string" &&
            typeof source.sourceUrl === "string"
              ? safeExternalUrl(source.sourceUrl)
                ? [
                    {
                      sourceTitle: source.sourceTitle,
                      sourceUrl: source.sourceUrl,
                    },
                  ]
                : []
              : [],
          )
        : [];
    return [
      {
        heading: section.heading,
        keyPoints:
          "keyPoints" in section ? stringsForDisplay(section.keyPoints) : [],
        sourceReferences,
      },
    ];
  });
}

interface BriefClaimDisplay {
  claim: string;
  sources: Array<{ sourceTitle: string; sourceUrl: string }>;
}

function briefClaimsForDisplay(value: unknown): BriefClaimDisplay[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((claim) => {
    if (
      !claim ||
      typeof claim !== "object" ||
      !("claim" in claim) ||
      typeof claim.claim !== "string"
    ) {
      return [];
    }
    const sources =
      "sourceReferences" in claim && Array.isArray(claim.sourceReferences)
        ? claim.sourceReferences.flatMap((source: unknown) => {
            if (
              !source ||
              typeof source !== "object" ||
              !("sourceTitle" in source) ||
              !("sourceUrl" in source) ||
              typeof source.sourceTitle !== "string" ||
              typeof source.sourceUrl !== "string" ||
              !safeExternalUrl(source.sourceUrl)
            ) {
              return [];
            }
            return [
              {
                sourceTitle: source.sourceTitle,
                sourceUrl: source.sourceUrl,
              },
            ];
          })
        : [];
    return [{ claim: claim.claim, sources }];
  });
}

function objectText(value: unknown, key: string): string {
  return value &&
    typeof value === "object" &&
    key in value &&
    typeof value[key as keyof typeof value] === "string"
    ? String(value[key as keyof typeof value])
    : "Not recorded";
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
        contentBriefs: {
          include: {
            briefGenerationJob: {
              select: {
                mode: true,
                status: true,
              },
            },
          },
          orderBy: {
            version: "desc",
          },
          take: 10,
        },
        researchJobs: {
          include: {
            notes: {
              orderBy: {
                createdAt: "asc",
              },
            },
          },
          orderBy: {
            createdAt: "desc",
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
            {topics.map((topic) => {
              const latestResearchJob = topic.researchJobs[0];
              const latestBrief = topic.contentBriefs[0];

              return (
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

                  {latestResearchJob ? (
                    <section className="research-summary">
                      <div className="topic-card-heading">
                        <div>
                          <h4>Latest research</h4>
                          <p className="topic-meta">
                            {latestResearchJob.status.toLowerCase()} {" · "}
                            {latestResearchJob.mode.toLowerCase()}
                            {latestResearchJob.deterministicFallbackUsed
                              ? " · deterministic fallback"
                              : ""}
                          </p>
                        </div>
                        <span className="count-badge">
                          {latestResearchJob.generatedNoteCount} notes
                        </span>
                      </div>

                      <dl className="source-metrics">
                        <div>
                          <dt>Started</dt>
                          <dd>
                            {formatTimestamp(latestResearchJob.startedAt)}
                          </dd>
                        </div>
                        <div>
                          <dt>Completed</dt>
                          <dd>
                            {formatTimestamp(latestResearchJob.completedAt)}
                          </dd>
                        </div>
                        <div>
                          <dt>Sources</dt>
                          <dd>
                            {latestResearchJob.successfulSourceCount}{" "}
                            successful, {latestResearchJob.skippedSourceCount}{" "}
                            skipped, {latestResearchJob.failedSourceCount}{" "}
                            failed
                          </dd>
                        </div>
                      </dl>

                      {latestResearchJob.errorSummary ? (
                        <p className="source-error">
                          Research error: {latestResearchJob.errorSummary}
                        </p>
                      ) : null}

                      {latestResearchJob.notes.map((note) => (
                        <article className="research-note" key={note.id}>
                          <h5>{note.title}</h5>
                          <p>{note.summary}</p>
                          <a
                            className="source-url"
                            href={note.sourceUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {note.sourceTitle}
                          </a>
                          <p className="topic-meta">
                            {note.sourcePublisher ?? "Unknown publisher"}{" "}
                            {" · "}
                            fetched {note.fetchedAt.toISOString()} {" · "}
                            {note.mode.toLowerCase()}
                          </p>

                          {claimsForDisplay(note.claims).length > 0 ? (
                            <ul className="claim-list">
                              {claimsForDisplay(note.claims).map(
                                (claim, index) => (
                                  <li key={`${note.id}-claim-${index}`}>
                                    <p>{claim.claim}</p>
                                    <blockquote>
                                      {claim.supportingExcerpt}
                                    </blockquote>
                                    <span>
                                      Confidence: {claim.confidence}
                                      {claim.evidenceId
                                        ? ` · Evidence: ${claim.evidenceId}`
                                        : " · Source configuration"}
                                    </span>
                                  </li>
                                ),
                              )}
                            </ul>
                          ) : (
                            <p className="muted">No factual claims recorded.</p>
                          )}
                        </article>
                      ))}
                    </section>
                  ) : (
                    <p className="muted topic-empty">
                      No research job has started.
                    </p>
                  )}

                  {latestBrief ? (
                    <section className="research-summary brief-summary">
                      <div className="topic-card-heading">
                        <div>
                          <h4>Current content brief</h4>
                          <p className="topic-meta">
                            Version {latestBrief.version} {" · "}
                            {latestBrief.briefGenerationJob.mode.toLowerCase()}{" "}
                            {" · "}
                            generation{" "}
                            {latestBrief.briefGenerationJob.status.toLowerCase()}{" "}
                            / {latestBrief.status.toLowerCase()}
                          </p>
                        </div>
                        <span className="count-badge">
                          {latestBrief.articleType.toLowerCase()}
                        </span>
                      </div>

                      <h5>{latestBrief.primaryTitle}</h5>
                      {stringsForDisplay(latestBrief.alternativeTitles).length >
                      0 ? (
                        <ul>
                          {stringsForDisplay(latestBrief.alternativeTitles).map(
                            (title) => (
                              <li key={title}>{title}</li>
                            ),
                          )}
                        </ul>
                      ) : null}

                      <dl className="source-metrics">
                        <div>
                          <dt>Audience</dt>
                          <dd>
                            {objectText(
                              latestBrief.targetAudience,
                              "description",
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Intent</dt>
                          <dd>
                            {latestBrief.intentType.toLowerCase()}:{" "}
                            {objectText(latestBrief.intent, "description")}
                          </dd>
                        </div>
                        <div>
                          <dt>Word count</dt>
                          <dd>
                            {latestBrief.estimatedWordCountMinimum}–
                            {latestBrief.estimatedWordCountMaximum}
                          </dd>
                        </div>
                        <div>
                          <dt>Created</dt>
                          <dd>{latestBrief.createdAt.toISOString()}</dd>
                        </div>
                      </dl>

                      <p>
                        <strong>Angle:</strong> {latestBrief.angle}
                      </p>
                      <p>
                        <strong>Purpose:</strong> {latestBrief.purpose}
                      </p>
                      <div className="brief-outline">
                        <h5>Structured outline</h5>
                        {briefSectionsForDisplay(latestBrief.outline).map(
                          (section) => (
                            <article
                              className="research-note"
                              key={section.heading}
                            >
                              <h5>{section.heading}</h5>
                              <ul>
                                {section.keyPoints.map((point) => (
                                  <li key={point}>{point}</li>
                                ))}
                              </ul>
                              {section.sourceReferences.map((source) => (
                                <a
                                  className="source-url"
                                  href={source.sourceUrl}
                                  key={`${section.heading}-${source.sourceUrl}`}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  {source.sourceTitle}
                                </a>
                              ))}
                            </article>
                          ),
                        )}
                      </div>

                      <div className="brief-outline">
                        <h5>Validated claims and provenance</h5>
                        {briefClaimsForDisplay(latestBrief.keyClaims).length >
                        0 ? (
                          <ul>
                            {briefClaimsForDisplay(latestBrief.keyClaims).map(
                              (claim) => (
                                <li key={claim.claim}>
                                  <span>{claim.claim}</span>
                                  {claim.sources.map((source) => (
                                    <a
                                      className="source-url"
                                      href={source.sourceUrl}
                                      key={`${claim.claim}-${source.sourceUrl}`}
                                      rel="noreferrer"
                                      target="_blank"
                                    >
                                      {source.sourceTitle}
                                    </a>
                                  ))}
                                </li>
                              ),
                            )}
                          </ul>
                        ) : (
                          <p className="muted">
                            No factual claims were approved.
                          </p>
                        )}
                      </div>

                      <details>
                        <summary>Planning checks and version history</summary>
                        <h5>Research gaps</h5>
                        <pre>
                          {JSON.stringify(latestBrief.researchGaps, null, 2)}
                        </pre>
                        <h5>Drafting instructions</h5>
                        <ul>
                          {stringsForDisplay(
                            latestBrief.draftingInstructions,
                          ).map((instruction) => (
                            <li key={instruction}>{instruction}</li>
                          ))}
                        </ul>
                        <h5>Quality checklist</h5>
                        <ul>
                          {stringsForDisplay(
                            latestBrief.qualityRequirements,
                          ).map((requirement) => (
                            <li key={requirement}>{requirement}</li>
                          ))}
                        </ul>
                        <h5>Version history</h5>
                        <ul>
                          {topic.contentBriefs.map((brief) => (
                            <li key={brief.id}>
                              v{brief.version}: {brief.primaryTitle} (
                              {brief.status.toLowerCase()},{" "}
                              {brief.briefGenerationJob.mode.toLowerCase()},{" "}
                              {brief.createdAt.toISOString()})
                            </li>
                          ))}
                        </ul>
                      </details>
                    </section>
                  ) : (
                    <p className="muted topic-empty">
                      No content brief has been generated.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
