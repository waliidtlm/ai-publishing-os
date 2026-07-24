import {
  AiUsageStatus,
  Prisma,
  ResearchJobStatus,
  ResearchMode,
  ResearchSourceStatus,
  ResearchTriggerType,
  TopicStatus,
  type PrismaClient,
} from "@ai-publishing-os/database";
import type {
  ResearchCompleteJobRequest,
  ResearchCreateJobRequest,
  ResearchEnvironment,
} from "@ai-publishing-os/schemas";

import type { OutboundLookup } from "../outbound/security";
import { transitionTopicStatus } from "../topics/transitions";

import { ResearchError } from "./errors";
import { extractResearchDocument } from "./extract";
import {
  createResearchContentFingerprint,
  createResearchRequestKey,
} from "./fingerprint";
import { fetchResearchSource, type ResearchFetchResult } from "./fetch-source";
import { calculateResearchJobStatus } from "./job-status";
import { DeterministicResearchProvider } from "./providers/deterministic";
import { OpenAiResearchProvider } from "./providers/openai";
import { researchPromptTemplateVersion } from "./providers/prompt";
import type {
  ResearchProvider,
  ResearchProviderResult,
} from "./providers/types";
import { mapResearchJobSummary } from "./response";
import { sanitizeResearchError } from "./sanitize";
import { selectResearchSources } from "./source-selection";

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

const triggerTypeMap = {
  internal_api: ResearchTriggerType.INTERNAL_API,
  manual: ResearchTriggerType.MANUAL,
  n8n: ResearchTriggerType.N8N,
} as const;

function isPrismaUniqueError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function isRetryableTransactionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}

function chooseJobMode(
  request: ResearchCreateJobRequest,
  environment: ResearchEnvironment,
): {
  deterministicFallbackUsed: boolean;
  metadata: Record<string, unknown>;
  mode: ResearchMode;
} {
  const requestedMode = request.mode ?? environment.RESEARCH_DEFAULT_MODE;

  if (requestedMode === "deterministic") {
    return {
      deterministicFallbackUsed: false,
      metadata: {
        deterministicMode: true,
        requestedMode,
      },
      mode: ResearchMode.DETERMINISTIC,
    };
  }

  if (!environment.RESEARCH_AI_ENABLED) {
    throw new ResearchError(
      "ai_configuration_error",
      "OpenAI research mode is disabled by server configuration.",
      422,
    );
  }

  if (!environment.AI_API_KEY) {
    if (!environment.RESEARCH_ALLOW_DETERMINISTIC_FALLBACK) {
      throw new ResearchError(
        "ai_configuration_error",
        "OpenAI research mode requires a configured server-side API key.",
        422,
      );
    }

    return {
      deterministicFallbackUsed: true,
      metadata: {
        deterministicFallbackReason: "missing_ai_api_key",
        deterministicMode: true,
        requestedMode,
      },
      mode: ResearchMode.DETERMINISTIC,
    };
  }

  return {
    deterministicFallbackUsed: false,
    metadata: {
      deterministicMode: false,
      requestedMode,
    },
    mode: ResearchMode.OPENAI,
  };
}

async function refreshResearchJobCounts(
  database: PrismaClient | Prisma.TransactionClient,
  researchJobId: string,
) {
  const [
    fetchedSourceCount,
    successfulSourceCount,
    skippedSourceCount,
    failedSourceCount,
    generatedNoteCount,
  ] = await Promise.all([
    database.researchJobSource.count({
      where: { fetchedAt: { not: null }, researchJobId },
    }),
    database.researchJobSource.count({
      where: { researchJobId, status: ResearchSourceStatus.SUCCEEDED },
    }),
    database.researchJobSource.count({
      where: { researchJobId, status: ResearchSourceStatus.SKIPPED },
    }),
    database.researchJobSource.count({
      where: { researchJobId, status: ResearchSourceStatus.FAILED },
    }),
    database.researchNote.count({ where: { researchJobId } }),
  ]);

  return database.researchJob.update({
    data: {
      failedSourceCount,
      fetchedSourceCount,
      generatedNoteCount,
      skippedSourceCount,
      successfulSourceCount,
    },
    where: { id: researchJobId },
  });
}

export async function createResearchJob(options: {
  correlationId: string;
  database: PrismaClient;
  environment: ResearchEnvironment;
  request: ResearchCreateJobRequest;
  topicId: string;
}) {
  const topic = await options.database.topic.findUnique({
    include: {
      evidence: true,
      site: {
        include: {
          sourceConfigs: {
            where: { isActive: true },
          },
        },
      },
    },
    where: { id: options.topicId },
  });

  if (!topic) {
    throw new ResearchError(
      "topic_not_found",
      "The research topic was not found.",
      404,
    );
  }

  if (topic.status === TopicStatus.RESEARCHING) {
    const activeJob = await options.database.researchJob.findFirst({
      select: { id: true },
      where: { activeTopicId: topic.id },
    });

    if (activeJob) {
      throw new ResearchError(
        "active_research_job_exists",
        "An active research job already exists for this topic.",
        409,
      );
    }
  }

  if (topic.status !== TopicStatus.APPROVED) {
    throw new ResearchError(
      "ineligible_topic",
      "Research can start only for an approved topic.",
      409,
    );
  }

  const selectedSources = selectResearchSources({
    evidence: topic.evidence,
    limit: options.environment.RESEARCH_MAX_SOURCES_PER_JOB,
    sourceConfigurations: topic.site.sourceConfigs,
  });

  if (selectedSources.length === 0) {
    throw new ResearchError(
      "no_research_sources",
      "The approved topic has no eligible research sources.",
      422,
    );
  }

  const selectedMode = chooseJobMode(options.request, options.environment);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await options.database.$transaction(
        async (transaction) => {
          const job = await transaction.researchJob.create({
            data: {
              activeTopicId: topic.id,
              deterministicFallbackUsed: selectedMode.deterministicFallbackUsed,
              metadata: asInputJson(selectedMode.metadata),
              mode: selectedMode.mode,
              selectedEvidenceCount: selectedSources.filter(
                (source) => source.evidenceId,
              ).length,
              siteId: topic.siteId,
              startedAt: new Date(),
              status: ResearchJobStatus.RUNNING,
              topicId: topic.id,
              triggerType: triggerTypeMap[options.request.triggerType],
              workflowExecutionReference:
                options.request.workflowExecutionReference,
            },
          });

          await transaction.researchJobSource.createMany({
            data: selectedSources.map((source) => ({
              ...source,
              researchJobId: job.id,
            })),
          });
          const jobSources = await transaction.researchJobSource.findMany({
            orderBy: { selectionRank: "asc" },
            where: { researchJobId: job.id },
          });

          await transitionTopicStatus(
            transaction,
            topic.id,
            TopicStatus.APPROVED,
            TopicStatus.RESEARCHING,
          );

          await transaction.auditLog.createMany({
            data: [
              {
                action: "research.job.created",
                dedupeKey: `research-job:${job.id}:created`,
                entityId: job.id,
                entityType: "research_job",
                newValue: asInputJson({
                  correlationId: options.correlationId,
                  mode: selectedMode.mode.toLowerCase(),
                  selectedSourceCount: selectedSources.length,
                  siteId: topic.siteId,
                  topicId: topic.id,
                }),
              },
              {
                action: "research.job.started",
                dedupeKey: `research-job:${job.id}:started`,
                entityId: job.id,
                entityType: "research_job",
                newValue: asInputJson({
                  correlationId: options.correlationId,
                  topicStatus: "researching",
                }),
              },
            ],
            skipDuplicates: true,
          });

          return {
            job: {
              ...mapResearchJobSummary(job),
            },
            sources: jobSources.map((source) => ({
              canonicalUrl: source.canonicalUrl,
              evidenceId: source.evidenceId,
              id: source.id,
              selectionRank: source.selectionRank,
              sourceConfigId: source.sourceConfigId,
              sourceTitle: source.sourceTitle,
              sourceUrl: source.sourceUrl,
              status: source.status.toLowerCase(),
            })),
          };
        },
        {
          isolationLevel: "Serializable",
          maxWait: 5_000,
          timeout: 15_000,
        },
      );
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        throw new ResearchError(
          "active_research_job_exists",
          "An active research job already exists for this topic.",
          409,
        );
      }

      if (isRetryableTransactionError(error) && attempt < 3) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Research job transaction retries were exhausted.");
}

export async function getResearchJob(
  database: PrismaClient,
  researchJobId: string,
) {
  const job = await database.researchJob.findUnique({
    include: {
      aiUsage: {
        orderBy: { createdAt: "asc" },
        select: {
          errorCode: true,
          inputTokens: true,
          model: true,
          outputTokens: true,
          provider: true,
          requestDurationMs: true,
          status: true,
        },
      },
      notes: {
        orderBy: { createdAt: "asc" },
      },
      sources: {
        orderBy: { selectionRank: "asc" },
      },
      topic: {
        select: {
          status: true,
          title: true,
        },
      },
    },
    where: { id: researchJobId },
  });

  if (!job) {
    throw new ResearchError(
      "research_job_not_found",
      "The research job was not found.",
      404,
    );
  }

  return job;
}

function createProvider(
  mode: ResearchMode,
  environment: ResearchEnvironment,
  provided?: ResearchProvider,
): ResearchProvider {
  if (provided) return provided;

  if (mode === ResearchMode.DETERMINISTIC) {
    return new DeterministicResearchProvider();
  }

  if (!environment.RESEARCH_AI_ENABLED || !environment.AI_API_KEY) {
    throw new ResearchError(
      "ai_configuration_error",
      "OpenAI research mode is not fully configured.",
      422,
    );
  }

  return new OpenAiResearchProvider({
    apiKey: environment.AI_API_KEY,
    maximumOutputTokens: environment.RESEARCH_MAX_OUTPUT_TOKENS,
    model: environment.AI_MODEL_RESEARCH,
  });
}

async function recordSourceFailure(options: {
  correlationId: string;
  database: PrismaClient;
  error: ResearchError;
  researchJobId: string;
  sourceId: string;
}) {
  const errorSummary =
    sanitizeResearchError(options.error.message) ??
    "The research source could not be processed.";

  await options.database.$transaction(async (transaction) => {
    await transaction.researchJobSource.update({
      data: {
        errorCode: options.error.code,
        errorSummary,
        status: ResearchSourceStatus.FAILED,
      },
      where: { id: options.sourceId },
    });

    await transaction.auditLog.createMany({
      data: [
        {
          action: "research.source.failed",
          dedupeKey: `research-source:${options.sourceId}:failed`,
          entityId: options.sourceId,
          entityType: "research_job_source",
          newValue: asInputJson({
            correlationId: options.correlationId,
            errorCode: options.error.code,
            researchJobId: options.researchJobId,
          }),
        },
      ],
      skipDuplicates: true,
    });

    await refreshResearchJobCounts(transaction, options.researchJobId);
  });

  return {
    error: {
      code: options.error.code,
      message: errorSummary,
      retryable: options.error.retryable,
    },
    sourceId: options.sourceId,
    status: "failed" as const,
  };
}

async function reserveAiUsage(options: {
  database: PrismaClient;
  maximumConcurrentAiPerSite: number;
  model: string;
  provider: string;
  requestKey: string;
  researchJobId: string;
  researchJobSourceId: string;
}) {
  try {
    return await options.database.$transaction(
      async (transaction) => {
        const job = await transaction.researchJob.findUniqueOrThrow({
          select: { siteId: true },
          where: { id: options.researchJobId },
        });
        const activeAiRequests = await transaction.aiUsage.count({
          where: {
            researchJob: { siteId: job.siteId },
            status: AiUsageStatus.STARTED,
          },
        });

        if (activeAiRequests >= options.maximumConcurrentAiPerSite) {
          throw new ResearchError(
            "research_concurrency_limited",
            "The site has reached its concurrent AI research limit.",
            429,
            true,
          );
        }

        return transaction.aiUsage.create({
          data: {
            model: options.model,
            promptTemplateVersion: researchPromptTemplateVersion,
            provider: options.provider,
            requestDurationMs: 0,
            requestKey: options.requestKey,
            researchJobId: options.researchJobId,
            researchJobSourceId: options.researchJobSourceId,
            status: AiUsageStatus.STARTED,
          },
        });
      },
      {
        isolationLevel: "Serializable",
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  } catch (error) {
    if (isRetryableTransactionError(error)) {
      throw new ResearchError(
        "research_concurrency_limited",
        "AI research concurrency changed; retry the request.",
        429,
        true,
      );
    }

    if (!isPrismaUniqueError(error)) throw error;

    const existing = await options.database.aiUsage.findUniqueOrThrow({
      where: { requestKey: options.requestKey },
    });

    if (
      existing.status === AiUsageStatus.SUCCEEDED &&
      existing.researchNoteId
    ) {
      return existing;
    }

    throw new ResearchError(
      "invalid_job_state",
      "This AI request was already attempted and will not be repeated automatically.",
      409,
    );
  }
}

async function generateProviderResult(options: {
  database: PrismaClient;
  environment: ResearchEnvironment;
  input: Parameters<ResearchProvider["generate"]>[0];
  provider: ResearchProvider;
  researchJobId: string;
  researchJobSourceId: string;
}): Promise<{
  aiUsageId: string | null;
  durationMs: number;
  provider: ResearchProvider;
  result: ResearchProviderResult;
}> {
  const isAi = options.provider.mode === ResearchMode.OPENAI;
  const requestKey = createResearchRequestKey({
    contentFingerprint: createResearchContentFingerprint(
      options.researchJobSourceId,
      options.input.sourceText,
    ),
    model: options.provider.model,
    provider: options.provider.name,
    researchJobSourceId: options.researchJobSourceId,
  });
  const usage = isAi
    ? await reserveAiUsage({
        database: options.database,
        maximumConcurrentAiPerSite:
          options.environment.RESEARCH_MAX_CONCURRENT_AI_PER_SITE,
        model: options.provider.model,
        provider: options.provider.name,
        requestKey,
        researchJobId: options.researchJobId,
        researchJobSourceId: options.researchJobSourceId,
      })
    : null;
  const startedAt = performance.now();

  try {
    const result = await options.provider.generate(options.input);
    return {
      aiUsageId: usage?.id ?? null,
      durationMs: Math.round(performance.now() - startedAt),
      provider: options.provider,
      result,
    };
  } catch (error) {
    if (usage) {
      const researchError =
        error instanceof ResearchError
          ? error
          : new ResearchError(
              "ai_provider_failed",
              "The research provider failed.",
              502,
            );
      await options.database.aiUsage.update({
        data: {
          errorCode: researchError.code,
          requestDurationMs: Math.round(performance.now() - startedAt),
          status: AiUsageStatus.FAILED,
        },
        where: { id: usage.id },
      });
    }

    throw error;
  }
}

export async function processResearchSource(options: {
  correlationId: string;
  database: PrismaClient;
  environment: ResearchEnvironment;
  fetchImplementation?: typeof fetch;
  lookup?: OutboundLookup;
  provider?: ResearchProvider;
  researchJobId: string;
  sourceId: string;
}) {
  const source = await options.database.researchJobSource.findFirst({
    include: {
      researchJob: {
        include: {
          topic: {
            select: {
              description: true,
              title: true,
            },
          },
        },
      },
    },
    where: {
      id: options.sourceId,
      researchJobId: options.researchJobId,
    },
  });

  if (!source) {
    throw new ResearchError(
      "research_source_not_found",
      "The selected research source was not found for this job.",
      404,
    );
  }

  const activeJobStatuses = new Set<ResearchJobStatus>([
    ResearchJobStatus.QUEUED,
    ResearchJobStatus.RUNNING,
  ]);

  if (!activeJobStatuses.has(source.researchJob.status)) {
    throw new ResearchError(
      "invalid_job_state",
      "The research job is not active.",
      409,
    );
  }

  if (source.status === ResearchSourceStatus.PROCESSING) {
    throw new ResearchError(
      "invalid_job_state",
      "The research source is already being processed.",
      409,
    );
  }

  let claimed;

  try {
    claimed = await options.database.$transaction(
      async (transaction) => {
        const processingCount = await transaction.researchJobSource.count({
          where: {
            researchJob: { siteId: source.researchJob.siteId },
            status: ResearchSourceStatus.PROCESSING,
          },
        });

        if (
          processingCount >= options.environment.RESEARCH_MAX_CONCURRENT_FETCHES
        ) {
          throw new ResearchError(
            "research_concurrency_limited",
            "The site has reached its concurrent research-fetch limit.",
            429,
            true,
          );
        }

        return transaction.researchJobSource.updateMany({
          data: {
            attemptCount: { increment: 1 },
            errorCode: null,
            errorSummary: null,
            status: ResearchSourceStatus.PROCESSING,
          },
          where: {
            id: source.id,
            status: source.status,
          },
        });
      },
      {
        isolationLevel: "Serializable",
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  } catch (error) {
    if (isRetryableTransactionError(error)) {
      throw new ResearchError(
        "research_concurrency_limited",
        "Research concurrency changed; retry the request.",
        429,
        true,
      );
    }

    throw error;
  }

  if (claimed.count !== 1) {
    throw new ResearchError(
      "invalid_job_state",
      "The research source state changed during processing.",
      409,
    );
  }

  try {
    const fetched: ResearchFetchResult = await fetchResearchSource({
      fetchImplementation: options.fetchImplementation,
      limits: {
        maxRedirects: options.environment.RESEARCH_MAX_REDIRECTS,
        maxResponseBytes: options.environment.RESEARCH_MAX_RESPONSE_BYTES,
        timeoutMs: options.environment.RESEARCH_REQUEST_TIMEOUT_MS,
      },
      lookup: options.lookup,
      sourceUrl: source.sourceUrl,
    });
    const extracted = extractResearchDocument({
      body: fetched.body,
      contentType: fetched.contentType,
      finalUrl: fetched.finalUrl,
      maximumTextLength: options.environment.RESEARCH_MAX_INPUT_CHARS,
      sourceTitle: source.sourceTitle,
    });
    const contentFingerprint = createResearchContentFingerprint(
      source.canonicalUrl,
      extracted.text,
    );
    const fetchedAt = new Date();
    const existingNote = await options.database.researchNote.findUnique({
      where: {
        researchJobSourceId_contentFingerprint: {
          contentFingerprint,
          researchJobSourceId: source.id,
        },
      },
    });

    if (existingNote) {
      await options.database.$transaction(async (transaction) => {
        await transaction.researchJobSource.update({
          data: {
            contentFingerprint,
            contentType: fetched.contentType,
            fetchedAt,
            status: ResearchSourceStatus.SUCCEEDED,
          },
          where: { id: source.id },
        });
        await refreshResearchJobCounts(transaction, options.researchJobId);
      });

      return {
        contentFingerprint,
        idempotentReplay: true,
        noteId: existingNote.id,
        sourceId: source.id,
        status: "succeeded" as const,
      };
    }

    const noteCount = await options.database.researchNote.count({
      where: { researchJobId: options.researchJobId },
    });

    if (noteCount >= options.environment.RESEARCH_MAX_NOTES_PER_JOB) {
      await options.database.$transaction(async (transaction) => {
        await transaction.researchJobSource.update({
          data: {
            contentFingerprint,
            contentType: fetched.contentType,
            errorCode: "note_limit_reached",
            errorSummary:
              "The configured research-note limit has already been reached.",
            fetchedAt,
            status: ResearchSourceStatus.SKIPPED,
          },
          where: { id: source.id },
        });
        await transaction.auditLog.createMany({
          data: [
            {
              action: "research.source.skipped",
              dedupeKey: `research-source:${source.id}:skipped`,
              entityId: source.id,
              entityType: "research_job_source",
              newValue: asInputJson({
                correlationId: options.correlationId,
                reason: "note_limit_reached",
                researchJobId: options.researchJobId,
              }),
            },
          ],
          skipDuplicates: true,
        });
        await refreshResearchJobCounts(transaction, options.researchJobId);
      });

      return {
        reason: "note_limit_reached",
        sourceId: source.id,
        status: "skipped" as const,
      };
    }

    const providerInput = {
      author: extracted.author,
      description: extracted.description,
      headings: extracted.headings,
      maximumClaims: options.environment.RESEARCH_MAX_CLAIMS_PER_SOURCE,
      maximumExcerptCharacters: options.environment.RESEARCH_MAX_EXCERPT_CHARS,
      sourceText: extracted.text,
      sourceTitle: extracted.title,
      sourceUrl: fetched.finalUrl,
      topicDescription: source.researchJob.topic.description,
      topicTitle: source.researchJob.topic.title,
    };
    let provider = createProvider(
      source.researchJob.mode,
      options.environment,
      options.provider,
    );
    let generated;
    let fallbackUsed = false;

    try {
      generated = await generateProviderResult({
        database: options.database,
        environment: options.environment,
        input: providerInput,
        provider,
        researchJobId: options.researchJobId,
        researchJobSourceId: source.id,
      });
    } catch (error) {
      if (
        provider.mode !== ResearchMode.OPENAI ||
        !options.environment.RESEARCH_ALLOW_DETERMINISTIC_FALLBACK
      ) {
        throw error;
      }

      fallbackUsed = true;
      provider = new DeterministicResearchProvider();
      generated = await generateProviderResult({
        database: options.database,
        environment: options.environment,
        input: providerInput,
        provider,
        researchJobId: options.researchJobId,
        researchJobSourceId: source.id,
      });
    }

    const claimProvenance = generated.result.output.keyClaims.map((claim) => ({
      ...claim,
      collectedAt: fetchedAt.toISOString(),
      evidenceId: source.evidenceId,
      sourceTitle: extracted.title,
      sourceUrl: fetched.finalUrl,
    }));
    const version =
      (await options.database.researchNote.count({
        where: { researchJobSourceId: source.id },
      })) + 1;

    const note = await options.database.$transaction(async (transaction) => {
      const created = await transaction.researchNote.create({
        data: {
          author: extracted.author,
          claims: asInputJson(claimProvenance),
          contentFingerprint,
          definitions: asInputJson(generated.result.output.definitions),
          evidenceId: source.evidenceId,
          examples: asInputJson(generated.result.output.examples),
          excerpts: asInputJson(
            claimProvenance.map((claim) => claim.supportingExcerpt),
          ),
          fetchedAt,
          metadata: asInputJson({
            canonicalUrl: extracted.canonicalUrl,
            deterministicFallbackUsed: fallbackUsed,
            deterministicMode: provider.mode === ResearchMode.DETERMINISTIC,
            promptTemplateVersion: researchPromptTemplateVersion,
            provider: provider.name,
            sourceContentStored: false,
          }),
          mode: provider.mode,
          openQuestions: asInputJson(generated.result.output.openQuestions),
          publishedAt: extracted.publishedAt,
          qualityFlags: asInputJson({
            deterministicExtraction:
              provider.mode === ResearchMode.DETERMINISTIC,
            modelConfidenceIsNotTruth: true,
            promptInjectionMitigated: true,
          }),
          researchJobId: options.researchJobId,
          researchJobSourceId: source.id,
          risks: asInputJson(generated.result.output.risks),
          siteId: source.researchJob.siteId,
          sourcePublisher: extracted.publisher,
          sourceTitle: extracted.title,
          sourceUrl: fetched.finalUrl,
          statistics: asInputJson(generated.result.output.statistics),
          summary: generated.result.output.summary,
          title: extracted.title,
          topicId: source.researchJob.topicId,
          version,
        },
      });

      await transaction.researchJobSource.update({
        data: {
          contentFingerprint,
          contentType: fetched.contentType,
          fetchedAt,
          status: ResearchSourceStatus.SUCCEEDED,
        },
        where: { id: source.id },
      });

      if (generated.aiUsageId) {
        await transaction.aiUsage.update({
          data: {
            estimatedCostUsd:
              generated.result.usage.estimatedCostUsd ?? undefined,
            inputTokens: generated.result.usage.inputTokens,
            outputTokens: generated.result.usage.outputTokens,
            requestDurationMs: generated.durationMs,
            researchNoteId: created.id,
            status: AiUsageStatus.SUCCEEDED,
          },
          where: { id: generated.aiUsageId },
        });
      }

      if (fallbackUsed) {
        await transaction.researchJob.update({
          data: { deterministicFallbackUsed: true },
          where: { id: options.researchJobId },
        });
      }

      await transaction.auditLog.createMany({
        data: [
          {
            action: "research.source.processed",
            dedupeKey: `research-source:${source.id}:processed:${contentFingerprint}`,
            entityId: source.id,
            entityType: "research_job_source",
            newValue: asInputJson({
              correlationId: options.correlationId,
              contentFingerprint,
              evidenceId: source.evidenceId,
              mode: provider.mode.toLowerCase(),
              researchJobId: options.researchJobId,
            }),
          },
          {
            action: "research.note.created",
            dedupeKey: `research-note:${created.id}:created`,
            entityId: created.id,
            entityType: "research_note",
            newValue: asInputJson({
              correlationId: options.correlationId,
              evidenceId: source.evidenceId,
              researchJobId: options.researchJobId,
              sourceId: source.id,
            }),
          },
        ],
        skipDuplicates: true,
      });

      await refreshResearchJobCounts(transaction, options.researchJobId);
      return created;
    });

    return {
      contentFingerprint,
      idempotentReplay: false,
      mode: provider.mode.toLowerCase(),
      noteId: note.id,
      sourceId: source.id,
      status: "succeeded" as const,
    };
  } catch (error) {
    const researchError =
      error instanceof ResearchError
        ? error
        : new ResearchError(
            "upstream_request_failed",
            "The research source could not be processed.",
            502,
          );

    return recordSourceFailure({
      correlationId: options.correlationId,
      database: options.database,
      error: researchError,
      researchJobId: options.researchJobId,
      sourceId: source.id,
    });
  }
}

export async function completeResearchJob(options: {
  correlationId: string;
  database: PrismaClient;
  request: ResearchCompleteJobRequest;
  researchJobId: string;
}) {
  const existing = await options.database.researchJob.findUnique({
    include: {
      sources: {
        select: { status: true },
      },
    },
    where: { id: options.researchJobId },
  });

  if (!existing) {
    throw new ResearchError(
      "research_job_not_found",
      "The research job was not found.",
      404,
    );
  }

  const terminalJobStatuses = new Set<ResearchJobStatus>([
    ResearchJobStatus.COMPLETED,
    ResearchJobStatus.PARTIAL,
    ResearchJobStatus.FAILED,
    ResearchJobStatus.CANCELLED,
  ]);

  if (terminalJobStatuses.has(existing.status)) {
    return existing;
  }

  const nonterminalSourceStatuses = new Set<ResearchSourceStatus>([
    ResearchSourceStatus.SELECTED,
    ResearchSourceStatus.PROCESSING,
  ]);

  if (
    existing.sources.some((source) =>
      nonterminalSourceStatuses.has(source.status),
    )
  ) {
    throw new ResearchError(
      "invalid_job_state",
      "All selected research sources must reach a terminal state first.",
      409,
    );
  }

  return options.database.$transaction(
    async (transaction) => {
      const counted = await refreshResearchJobCounts(
        transaction,
        options.researchJobId,
      );
      const status = calculateResearchJobStatus(counted);
      const completedAt = new Date();
      const failed = status === ResearchJobStatus.FAILED;
      const errorSummary = sanitizeResearchError(options.request.errorSummary);
      const updated = await transaction.researchJob.update({
        data: {
          activeTopicId: null,
          completedAt,
          errorCode: failed
            ? (options.request.errorCode ?? "no_usable_research_notes")
            : options.request.errorCode,
          errorSummary: failed
            ? (errorSummary ?? "No source produced a usable research note.")
            : errorSummary,
          failedAt: failed ? completedAt : null,
          status,
        },
        where: { id: options.researchJobId },
      });

      if (failed) {
        await transitionTopicStatus(
          transaction,
          existing.topicId,
          TopicStatus.RESEARCHING,
          TopicStatus.FAILED,
        );
      } else {
        await transitionTopicStatus(
          transaction,
          existing.topicId,
          TopicStatus.RESEARCHING,
          TopicStatus.BRIEF_READY,
        );
      }

      const statusName = status.toLowerCase();
      await transaction.auditLog.createMany({
        data: [
          {
            action: `research.job.${statusName}`,
            dedupeKey: `research-job:${existing.id}:${statusName}`,
            entityId: existing.id,
            entityType: "research_job",
            newValue: asInputJson({
              correlationId: options.correlationId,
              failedSourceCount: counted.failedSourceCount,
              generatedNoteCount: counted.generatedNoteCount,
              skippedSourceCount: counted.skippedSourceCount,
              successfulSourceCount: counted.successfulSourceCount,
              topicStatus: failed ? "failed" : "brief_ready",
            }),
          },
        ],
        skipDuplicates: true,
      });

      return updated;
    },
    {
      isolationLevel: "Serializable",
      maxWait: 5_000,
      timeout: 15_000,
    },
  );
}
