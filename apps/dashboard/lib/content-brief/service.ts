import {
  AiOperationType,
  AiUsageStatus,
  ArticleType,
  BriefGenerationJobStatus,
  ContentBriefStatus,
  Prisma,
  ReaderIntentType,
  ResearchMode,
  TopicStatus,
  type PrismaClient,
} from "@ai-publishing-os/database";
import type {
  ContentBriefCreateJobRequest,
  ContentBriefEnvironment,
  ContentBriefProviderOutput,
} from "@ai-publishing-os/schemas";

import { transitionTopicStatus } from "../topics/transitions";
import { ContentBriefError, safeBriefErrorSummary } from "./errors";
import { fingerprintBriefValue } from "./fingerprint";
import { selectBriefResearchInput } from "./input-selection";
import { DeterministicBriefProvider } from "./providers/deterministic";
import { OpenAiBriefProvider } from "./providers/openai";
import {
  buildContentBriefPrompt,
  contentBriefPromptTemplateVersion,
} from "./providers/prompt";
import type {
  BriefProvider,
  BriefProviderResult,
  BriefResearchSnapshot,
} from "./types";
import {
  validateBriefOutput,
  verifyBriefResearchSnapshotOwnership,
} from "./validation";

const intentMap: Record<
  ContentBriefProviderOutput["intent"]["type"],
  ReaderIntentType
> = {
  comparison: ReaderIntentType.COMPARISON,
  decision_support: ReaderIntentType.DECISION_SUPPORT,
  how_to: ReaderIntentType.HOW_TO,
  informational: ReaderIntentType.INFORMATIONAL,
  navigational: ReaderIntentType.NAVIGATIONAL,
  thought_leadership: ReaderIntentType.THOUGHT_LEADERSHIP,
  transactional: ReaderIntentType.TRANSACTIONAL,
  troubleshooting: ReaderIntentType.TROUBLESHOOTING,
};

const articleTypeMap: Record<
  ContentBriefProviderOutput["articleType"],
  ArticleType
> = {
  case_study: ArticleType.CASE_STUDY,
  checklist: ArticleType.CHECKLIST,
  comparison: ArticleType.COMPARISON,
  explainer: ArticleType.EXPLAINER,
  guide: ArticleType.GUIDE,
  news_analysis: ArticleType.NEWS_ANALYSIS,
  opinion: ArticleType.OPINION,
  reference: ArticleType.REFERENCE,
  troubleshooting: ArticleType.TROUBLESHOOTING,
  tutorial: ArticleType.TUTORIAL,
};

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isUniqueError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2002",
  );
}

function isRetryableTransactionError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2034",
  );
}

function chooseMode(
  request: ContentBriefCreateJobRequest,
  environment: ContentBriefEnvironment,
) {
  const requestedMode = request.mode ?? environment.CONTENT_BRIEF_DEFAULT_MODE;
  if (requestedMode === "deterministic") {
    return {
      fallbackUsed: false,
      mode: ResearchMode.DETERMINISTIC,
      requestedMode,
    };
  }
  if (!environment.CONTENT_BRIEF_AI_ENABLED) {
    throw new ContentBriefError(
      "ai_configuration_error",
      "OpenAI content-brief mode is disabled by server configuration.",
      422,
    );
  }
  if (!environment.AI_API_KEY) {
    if (!environment.CONTENT_BRIEF_ALLOW_DETERMINISTIC_FALLBACK) {
      throw new ContentBriefError(
        "ai_configuration_error",
        "OpenAI content-brief mode requires a server-side API key.",
        422,
      );
    }
    return {
      fallbackUsed: true,
      mode: ResearchMode.DETERMINISTIC,
      requestedMode,
    };
  }
  return {
    fallbackUsed: false,
    mode: ResearchMode.OPENAI,
    requestedMode,
  };
}

export async function createBriefGenerationJob(options: {
  correlationId: string;
  database: PrismaClient;
  environment: ContentBriefEnvironment;
  request: ContentBriefCreateJobRequest;
  topicId: string;
}) {
  const topic = await options.database.topic.findUnique({
    include: {
      contentBriefs: {
        include: {
          briefGenerationJob: true,
        },
        orderBy: { version: "desc" },
        take: 1,
      },
    },
    where: { id: options.topicId },
  });
  if (!topic) {
    throw new ContentBriefError(
      "topic_not_found",
      "The content-brief topic was not found.",
      404,
    );
  }
  const currentBrief = topic.contentBriefs[0] ?? null;
  const regeneration =
    options.request.forceRegeneration && Boolean(currentBrief);
  if (
    topic.status === TopicStatus.DRAFTING &&
    currentBrief &&
    !options.request.forceRegeneration &&
    !options.request.adjustment &&
    currentBrief.briefGenerationJob.mode.toLowerCase() ===
      (options.request.mode ?? options.environment.CONTENT_BRIEF_DEFAULT_MODE)
  ) {
    const { briefGenerationJob, ...brief } = currentBrief;
    return {
      brief,
      idempotentReplay: true,
      job: briefGenerationJob,
    };
  }
  if (
    topic.status !== TopicStatus.BRIEF_READY &&
    !(topic.status === TopicStatus.DRAFTING && regeneration)
  ) {
    throw new ContentBriefError(
      "ineligible_topic",
      "A content brief can start only for a brief-ready topic or an explicit regeneration of a drafting topic.",
      409,
    );
  }
  const active = await options.database.briefGenerationJob.findFirst({
    select: { id: true },
    where: { activeTopicId: topic.id },
  });
  if (active) {
    throw new ContentBriefError(
      "active_brief_job_exists",
      "An active brief-generation job already exists for this topic.",
      409,
    );
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1_000);
  const [recentSiteCount, recentTopicCount] = await Promise.all([
    options.database.briefGenerationJob.count({
      where: { createdAt: { gte: hourAgo }, siteId: topic.siteId },
    }),
    options.database.briefGenerationJob.count({
      where: { createdAt: { gte: hourAgo }, topicId: topic.id },
    }),
  ]);
  if (
    recentSiteCount >=
      options.environment.CONTENT_BRIEF_MAX_GENERATIONS_PER_HOUR ||
    recentTopicCount >=
      options.environment.CONTENT_BRIEF_MAX_GENERATIONS_PER_TOPIC_PER_HOUR
  ) {
    throw new ContentBriefError(
      "brief_generation_rate_limited",
      "The site content-brief generation limit was reached.",
      429,
      true,
    );
  }

  const selected = await selectBriefResearchInput({
    database: options.database,
    environment: options.environment,
    topicId: topic.id,
  });
  const mode = chooseMode(options.request, options.environment);
  const prompt = buildContentBriefPrompt({
    adjustment: options.request.adjustment ?? null,
    maximumOutlineSections:
      options.environment.CONTENT_BRIEF_MAX_OUTLINE_SECTIONS,
    snapshot: selected.snapshot,
  });
  if (
    Array.from(prompt).length >
    options.environment.CONTENT_BRIEF_MAX_PROMPT_CHARS
  ) {
    throw new ContentBriefError(
      "research_input_too_large",
      "The complete content-brief prompt exceeds the configured input limit.",
      422,
    );
  }
  const inputFingerprint = fingerprintBriefValue({
    adjustment: options.request.adjustment ?? null,
    generationSequence: regeneration ? (currentBrief?.version ?? 0) + 1 : 1,
    mode: mode.mode,
    maximumOutlineSections:
      options.environment.CONTENT_BRIEF_MAX_OUTLINE_SECTIONS,
    promptTemplateVersion: contentBriefPromptTemplateVersion,
    researchSnapshotFingerprint: selected.fingerprint,
    topicId: topic.id,
  });

  if (!options.request.forceRegeneration) {
    const existingBrief = await options.database.contentBrief.findUnique({
      where: {
        topicId_inputFingerprint: {
          inputFingerprint,
          topicId: topic.id,
        },
      },
    });
    if (existingBrief) {
      return {
        brief: existingBrief,
        idempotentReplay: true,
        job: await options.database.briefGenerationJob.findUniqueOrThrow({
          where: { id: existingBrief.briefGenerationJobId },
        }),
      };
    }
  }

  try {
    const job = await options.database.$transaction(
      async (transaction) => {
        const created = await transaction.briefGenerationJob.create({
          data: {
            activeTopicId: topic.id,
            adjustmentRequest: options.request.adjustment
              ? asInputJson(options.request.adjustment)
              : undefined,
            includedSourceCount: selected.snapshot.sources.length,
            inputClaimCount: selected.snapshot.claims.length,
            inputFingerprint,
            inputNoteCount: selected.snapshot.notes.length,
            metadata: asInputJson({
              deterministicFallbackUsed: mode.fallbackUsed,
              requestedMode: mode.requestedMode,
              maximumOutlineSections:
                options.environment.CONTENT_BRIEF_MAX_OUTLINE_SECTIONS,
              triggerType: options.request.triggerType,
            }),
            mode: mode.mode,
            promptTemplateVersion: contentBriefPromptTemplateVersion,
            regenerationReason: options.request.regenerationReason,
            researchJobId: selected.researchJobId,
            researchSnapshot: asInputJson(selected.snapshot),
            researchSnapshotFingerprint: selected.fingerprint,
            siteId: topic.siteId,
            status: BriefGenerationJobStatus.QUEUED,
            topicId: topic.id,
            workflowExecutionReference:
              options.request.workflowExecutionReference,
          },
        });
        await transaction.auditLog.createMany({
          data: [
            {
              action: regeneration
                ? "brief.regeneration.requested"
                : "brief.job.created",
              dedupeKey: `brief-job:${created.id}:created`,
              entityId: created.id,
              entityType: "brief_generation_job",
              newValue: asInputJson({
                correlationId: options.correlationId,
                inputClaimCount: selected.snapshot.claims.length,
                inputNoteCount: selected.snapshot.notes.length,
                mode: mode.mode.toLowerCase(),
                researchJobId: selected.researchJobId,
                siteId: topic.siteId,
                topicId: topic.id,
              }),
            },
          ],
          skipDuplicates: true,
        });
        return created;
      },
      { isolationLevel: "Serializable", maxWait: 5_000, timeout: 15_000 },
    );
    return { brief: null, idempotentReplay: false, job };
  } catch (error) {
    if (isUniqueError(error)) {
      throw new ContentBriefError(
        "active_brief_job_exists",
        "An active brief-generation job already exists for this topic.",
        409,
      );
    }
    throw error;
  }
}

function createProvider(
  jobMode: ResearchMode,
  environment: ContentBriefEnvironment,
  injected?: BriefProvider,
): BriefProvider {
  if (injected) return injected;
  if (jobMode === ResearchMode.DETERMINISTIC)
    return new DeterministicBriefProvider();
  if (!environment.AI_API_KEY) {
    throw new ContentBriefError(
      "ai_configuration_error",
      "The configured brief provider is unavailable.",
      422,
    );
  }
  return new OpenAiBriefProvider({
    apiKey: environment.AI_API_KEY,
    maximumOutputTokens: environment.CONTENT_BRIEF_MAX_OUTPUT_TOKENS,
    model: environment.AI_MODEL_CONTENT_BRIEF,
  });
}

async function callProvider(options: {
  database: PrismaClient;
  input: Parameters<BriefProvider["generate"]>[0];
  jobId: string;
  maximumConcurrentAi: number;
  provider: BriefProvider;
  siteId: string;
}): Promise<BriefProviderResult> {
  const requestKey = `${options.jobId}:content-brief:${options.provider.name}:${options.provider.model}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await options.database.$transaction(
        async (transaction) => {
          const existing = await transaction.aiUsage.findUnique({
            where: { requestKey },
          });
          if (existing) {
            throw new ContentBriefError(
              "ai_request_already_reserved",
              "This provider request was already attempted and will not be replayed automatically.",
              409,
            );
          }
          if (options.provider.name !== "deterministic") {
            const activeAi = await transaction.aiUsage.count({
              where: {
                briefGenerationJob: {
                  is: {
                    siteId: options.siteId,
                    status: BriefGenerationJobStatus.RUNNING,
                  },
                },
                operationType: AiOperationType.CONTENT_BRIEF,
                provider: { not: "deterministic" },
                status: AiUsageStatus.STARTED,
              },
            });
            if (activeAi >= options.maximumConcurrentAi) {
              throw new ContentBriefError(
                "brief_ai_concurrency_limited",
                "The site has reached its concurrent content-brief AI limit.",
                429,
                true,
              );
            }
          }
          await transaction.aiUsage.create({
            data: {
              briefGenerationJobId: options.jobId,
              operationType: AiOperationType.CONTENT_BRIEF,
              model: options.provider.model,
              promptTemplateVersion: contentBriefPromptTemplateVersion,
              provider: options.provider.name,
              requestDurationMs: 0,
              requestKey,
              status: AiUsageStatus.STARTED,
            },
          });
        },
        { isolationLevel: "Serializable", maxWait: 5_000, timeout: 10_000 },
      );
      break;
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < 3) continue;
      throw error;
    }
  }
  const startedAt = performance.now();
  try {
    const result = await options.provider.generate(options.input);
    result.output = validateBriefOutput(result.output, options.input.snapshot, {
      maximumOutlineSections: options.input.maximumOutlineSections,
    });
    await options.database.aiUsage.update({
      data: {
        estimatedCostUsd: result.usage.estimatedCostUsd,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        requestDurationMs: Math.round(performance.now() - startedAt),
        status: AiUsageStatus.SUCCEEDED,
      },
      where: { requestKey },
    });
    return result;
  } catch (error) {
    await options.database.aiUsage.update({
      data: {
        errorCode:
          error instanceof ContentBriefError
            ? error.code
            : "ai_provider_failed",
        requestDurationMs: Math.round(performance.now() - startedAt),
        status: AiUsageStatus.FAILED,
      },
      where: { requestKey },
    });
    throw error;
  }
}

async function failBriefJob(
  database: PrismaClient,
  jobId: string,
  correlationId: string,
  error: unknown,
) {
  const code =
    error instanceof ContentBriefError ? error.code : "brief_generation_failed";
  const summary =
    safeBriefErrorSummary(
      error instanceof Error ? error.message : "Brief generation failed.",
    ) ?? "Brief generation failed.";
  await database.$transaction(async (transaction) => {
    await transaction.briefGenerationJob.updateMany({
      data: {
        activeTopicId: null,
        errorCode: code,
        errorSummary: summary,
        failedAt: new Date(),
        status: BriefGenerationJobStatus.FAILED,
      },
      where: {
        id: jobId,
        status: {
          in: [
            BriefGenerationJobStatus.QUEUED,
            BriefGenerationJobStatus.RUNNING,
          ],
        },
      },
    });
    await transaction.auditLog.createMany({
      data: [
        {
          action: "brief.generation.failed",
          dedupeKey: `brief-job:${jobId}:failed`,
          entityId: jobId,
          entityType: "brief_generation_job",
          newValue: asInputJson({ correlationId, errorCode: code }),
        },
      ],
      skipDuplicates: true,
    });
  });
}

export async function generateContentBrief(options: {
  correlationId: string;
  database: PrismaClient;
  environment: ContentBriefEnvironment;
  jobId: string;
  provider?: BriefProvider;
}) {
  const job = await options.database.briefGenerationJob.findUnique({
    include: { briefs: true, topic: { select: { status: true } } },
    where: { id: options.jobId },
  });
  if (!job) {
    throw new ContentBriefError(
      "brief_job_not_found",
      "The brief-generation job was not found.",
      404,
    );
  }
  if (job.status === BriefGenerationJobStatus.COMPLETED && job.briefs[0]) {
    return { brief: job.briefs[0], idempotentReplay: true, job };
  }
  if (job.status !== BriefGenerationJobStatus.QUEUED) {
    throw new ContentBriefError(
      "invalid_job_state",
      "Only a queued brief-generation job can be generated.",
      409,
    );
  }
  await options.database.$transaction(async (transaction) => {
    const started = await transaction.briefGenerationJob.updateMany({
      data: {
        startedAt: new Date(),
        status: BriefGenerationJobStatus.RUNNING,
      },
      where: { id: job.id, status: BriefGenerationJobStatus.QUEUED },
    });
    if (started.count !== 1) {
      throw new ContentBriefError(
        "invalid_job_state",
        "The brief-generation job is already running.",
        409,
      );
    }
    await transaction.auditLog.createMany({
      data: [
        {
          action: "brief.job.started",
          dedupeKey: `brief-job:${job.id}:started`,
          entityId: job.id,
          entityType: "brief_generation_job",
          newValue: asInputJson({ correlationId: options.correlationId }),
        },
      ],
      skipDuplicates: true,
    });
  });

  try {
    const snapshot = job.researchSnapshot as unknown as BriefResearchSnapshot;
    await verifyBriefResearchSnapshotOwnership({
      database: options.database,
      researchJobId: job.researchJobId,
      siteId: job.siteId,
      snapshot,
      topicId: job.topicId,
    });
    const provider = createProvider(
      job.mode,
      options.environment,
      options.provider,
    );
    const generated = await callProvider({
      database: options.database,
      input: {
        adjustment: (job.adjustmentRequest ?? null) as Parameters<
          BriefProvider["generate"]
        >[0]["adjustment"],
        maximumOutlineSections:
          job.metadata &&
          typeof job.metadata === "object" &&
          !Array.isArray(job.metadata) &&
          "maximumOutlineSections" in job.metadata &&
          typeof job.metadata.maximumOutlineSections === "number"
            ? job.metadata.maximumOutlineSections
            : options.environment.CONTENT_BRIEF_MAX_OUTLINE_SECTIONS,
        snapshot,
      },
      jobId: job.id,
      maximumConcurrentAi:
        options.environment.CONTENT_BRIEF_MAX_CONCURRENT_AI_PER_SITE,
      provider,
      siteId: job.siteId,
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const result = await options.database.$transaction(
          async (transaction) => {
            const latest = await transaction.contentBrief.aggregate({
              _max: { version: true },
              where: { topicId: job.topicId },
            });
            const version = (latest._max.version ?? 0) + 1;
            await transaction.contentBrief.updateMany({
              data: {
                currentTopicId: null,
                status: ContentBriefStatus.SUPERSEDED,
              },
              where: { currentTopicId: job.topicId },
            });
            const output = generated.output;
            const brief = await transaction.contentBrief.create({
              data: {
                alternativeTitles: asInputJson(output.alternativeTitles),
                angle: output.angle,
                articleType: articleTypeMap[output.articleType],
                briefGenerationJobId: job.id,
                currentTopicId: job.topicId,
                definitions: asInputJson(output.definitions),
                draftingInstructions: asInputJson(output.draftingInstructions),
                estimatedWordCountMaximum: output.estimatedWordCount.maximum,
                estimatedWordCountMinimum: output.estimatedWordCount.minimum,
                examples: asInputJson(output.examples),
                exclusions: asInputJson(output.scope.exclude),
                externalReferenceRequirements: asInputJson(
                  output.externalReferenceRequirements,
                ),
                inputFingerprint: job.inputFingerprint,
                intent: asInputJson(output.intent),
                intentType: intentMap[output.intent.type],
                internalLinkSuggestions: asInputJson(
                  output.internalLinkSuggestions,
                ),
                keyClaims: asInputJson(output.keyClaims),
                metadata: asInputJson({
                  deterministicMode: provider.name === "deterministic",
                  promptTemplateVersion: job.promptTemplateVersion,
                }),
                outline: asInputJson(output.outline),
                primaryTitle: output.primaryTitle,
                purpose: output.purpose,
                qualityRequirements: asInputJson(output.qualityChecklist),
                questionsToAnswer: asInputJson(output.questionsToAnswer),
                requiredSources: asInputJson(output.requiredSources),
                researchGaps: asInputJson(output.researchGaps),
                researchJobId: job.researchJobId,
                researchSnapshot: asInputJson(job.researchSnapshot),
                researchSnapshotFingerprint: job.researchSnapshotFingerprint,
                risksAndCaveats: asInputJson(output.risksAndCaveats),
                scope: asInputJson(output.scope.include),
                siteId: job.siteId,
                statistics: asInputJson(output.statistics),
                status: ContentBriefStatus.CURRENT,
                targetAudience: asInputJson(output.targetAudience),
                targetDepth: output.targetDepth,
                tone: output.tone,
                topicId: job.topicId,
                version,
              },
            });
            await transaction.aiUsage.updateMany({
              data: { contentBriefId: brief.id },
              where: { briefGenerationJobId: job.id },
            });
            const completedAt = new Date();
            const updatedJob = await transaction.briefGenerationJob.update({
              data: {
                activeTopicId: null,
                completedAt,
                generatedSectionCount: output.outline.length,
                status: BriefGenerationJobStatus.COMPLETED,
              },
              where: { id: job.id },
            });
            let transitioned = false;
            if (job.topic.status === TopicStatus.BRIEF_READY) {
              await transitionTopicStatus(
                transaction,
                job.topicId,
                TopicStatus.BRIEF_READY,
                TopicStatus.DRAFTING,
              );
              transitioned = true;
            }
            await transaction.auditLog.createMany({
              data: [
                {
                  action: "brief.generation.completed",
                  dedupeKey: `brief-job:${job.id}:completed`,
                  entityId: job.id,
                  entityType: "brief_generation_job",
                  newValue: asInputJson({
                    briefId: brief.id,
                    correlationId: options.correlationId,
                    sectionCount: output.outline.length,
                    version,
                  }),
                },
                {
                  action: "brief.version.created",
                  dedupeKey: `brief:${brief.id}:created`,
                  entityId: brief.id,
                  entityType: "content_brief",
                  newValue: asInputJson({
                    correlationId: options.correlationId,
                    topicId: job.topicId,
                    version,
                  }),
                },
                {
                  action: "brief.version.activated",
                  dedupeKey: `brief:${brief.id}:activated`,
                  entityId: brief.id,
                  entityType: "content_brief",
                  newValue: asInputJson({ version }),
                },
                ...(transitioned
                  ? [
                      {
                        action: "topic.transitioned_to_drafting",
                        dedupeKey: `topic:${job.topicId}:brief:${brief.id}:drafting`,
                        entityId: job.topicId,
                        entityType: "topic",
                        newValue: asInputJson({
                          from: "brief_ready",
                          to: "drafting",
                        }),
                      },
                    ]
                  : []),
              ],
              skipDuplicates: true,
            });
            return { brief, updatedJob };
          },
          {
            isolationLevel: "Serializable",
            maxWait: 5_000,
            timeout: 20_000,
          },
        );
        return {
          brief: result.brief,
          idempotentReplay: false,
          job: result.updatedJob,
        };
      } catch (error) {
        if (isRetryableTransactionError(error) && attempt < 3) continue;
        throw error;
      }
    }
    throw new Error("Content brief transaction retries were exhausted.");
  } catch (error) {
    await failBriefJob(options.database, job.id, options.correlationId, error);
    throw error;
  }
}

export async function getBriefGenerationJob(
  database: PrismaClient,
  jobId: string,
) {
  const job = await database.briefGenerationJob.findUnique({
    include: {
      aiUsage: {
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
      briefs: true,
      topic: { select: { status: true, title: true } },
    },
    where: { id: jobId },
  });
  if (!job) {
    throw new ContentBriefError(
      "brief_job_not_found",
      "The brief-generation job was not found.",
      404,
    );
  }
  return job;
}

export async function getTopicBriefs(database: PrismaClient, topicId: string) {
  const topic = await database.topic.findUnique({
    select: { id: true },
    where: { id: topicId },
  });
  if (!topic) {
    throw new ContentBriefError(
      "topic_not_found",
      "The content-brief topic was not found.",
      404,
    );
  }
  return database.contentBrief.findMany({
    include: {
      briefGenerationJob: {
        select: { mode: true, status: true },
      },
    },
    orderBy: { version: "desc" },
    where: { topicId },
  });
}
