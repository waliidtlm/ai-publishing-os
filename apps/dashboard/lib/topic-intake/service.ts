import {
  EvidenceType,
  Prisma,
  type PrismaClient,
} from "@ai-publishing-os/database";
import type { TopicIntakeRequest } from "@ai-publishing-os/schemas";
import {
  createEvidenceFingerprint,
  hashTopicIntakeRequest,
  normalizeTopicTitle,
} from "@ai-publishing-os/shared";

import {
  IdempotencyConflictError,
  InactiveSourceConfigurationError,
  IntakeResourceNotFoundError,
} from "./errors";
import type { TopicIntakeResult } from "./result";

const maximumTransactionAttempts = 4;

const evidenceTypeMap: Record<
  NonNullable<TopicIntakeRequest["source"]>["evidenceType"],
  EvidenceType
> = {
  competitor: EvidenceType.COMPETITOR,
  keyword: EvidenceType.KEYWORD,
  manual: EvidenceType.MANUAL,
  performance: EvidenceType.PERFORMANCE,
  source: EvidenceType.SOURCE,
  trend: EvidenceType.TREND,
};

export interface ProcessTopicIntakeOptions {
  correlationId: string;
  database: PrismaClient;
  request: TopicIntakeRequest;
}

export interface ProcessTopicIntakeResponse {
  httpStatus: 200 | 201;
  result: TopicIntakeResult;
}

function idempotencyScope(siteId: string): string {
  return `topic-intake:${siteId}:internal-api`;
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isRetryableTransactionError(error: unknown): boolean {
  const prismaTransactionConflict =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "P2002" || error.code === "P2034");

  if (prismaTransactionConflict) {
    return true;
  }

  if (!(error instanceof Error) || error.name !== "DriverAdapterError") {
    return false;
  }

  const adapterCause = (
    error as Error & {
      cause?: {
        kind?: unknown;
      };
    }
  ).cause;

  return (
    error.message.includes("TransactionWriteConflict") ||
    adapterCause?.kind === "TransactionWriteConflict"
  );
}

function isStoredResult(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.topicId === "string"
  );
}

async function resolveExistingIdempotencyRecord(
  database: PrismaClient,
  scope: string,
  key: string,
  requestHash: string,
): Promise<ProcessTopicIntakeResponse | null> {
  const existing = await database.intakeIdempotencyRecord.findUnique({
    where: {
      scope_key: {
        key,
        scope,
      },
    },
  });

  if (!existing) {
    return null;
  }

  if (existing.requestHash !== requestHash) {
    throw new IdempotencyConflictError();
  }

  if (!existing.responseBody || !isStoredResult(existing.responseBody)) {
    throw new Error("The stored idempotency result is incomplete.");
  }

  const stored = existing.responseBody as unknown as TopicIntakeResult;

  return {
    httpStatus: 200,
    result: {
      ...stored,
      idempotentReplay: true,
    },
  };
}

async function processInTransaction({
  correlationId,
  database,
  request,
}: ProcessTopicIntakeOptions): Promise<ProcessTopicIntakeResponse> {
  const normalizedTitle = normalizeTopicTitle(request.title);
  const requestHash = hashTopicIntakeRequest(request);
  const scope = idempotencyScope(request.siteId);

  return database.$transaction(
    async (transaction) => {
      const idempotencyRecord =
        await transaction.intakeIdempotencyRecord.create({
          data: {
            key: request.idempotencyKey,
            requestHash,
            scope,
          },
        });

      const site = await transaction.site.findUnique({
        select: {
          id: true,
        },
        where: {
          id: request.siteId,
        },
      });

      if (!site) {
        throw new IntakeResourceNotFoundError(
          "site_not_found",
          "The submitted site was not found.",
        );
      }

      if (request.source?.sourceConfigId) {
        const sourceConfiguration = await transaction.sourceConfig.findFirst({
          select: {
            isActive: true,
          },
          where: {
            id: request.source.sourceConfigId,
            siteId: request.siteId,
          },
        });

        if (!sourceConfiguration) {
          throw new IntakeResourceNotFoundError(
            "source_configuration_not_found",
            "The source configuration was not found for the submitted site.",
          );
        }

        if (!sourceConfiguration.isActive) {
          throw new InactiveSourceConfigurationError();
        }
      }

      let topic = await transaction.topic.findUnique({
        where: {
          siteId_normalizedTitle: {
            normalizedTitle,
            siteId: request.siteId,
          },
        },
      });
      const topicCreated = !topic;

      if (!topic) {
        topic = await transaction.topic.create({
          data: {
            description: request.description,
            intakeMetadata: request.metadata
              ? asInputJson(request.metadata)
              : undefined,
            intakeOrigin: "internal_api",
            normalizedTitle,
            siteId: request.siteId,
            title: request.title,
          },
        });
      }

      let evidenceId: string | null = null;
      let evidenceCreated = false;

      if (request.source) {
        const evidenceType = evidenceTypeMap[request.source.evidenceType];
        const evidenceFingerprint = createEvidenceFingerprint({
          evidenceType: request.source.evidenceType,
          externalId: request.externalId,
          sourceConfigId: request.source.sourceConfigId,
          sourceUrl: request.source.sourceUrl,
        });
        const existingEvidence = await transaction.topicEvidence.findFirst({
          select: {
            id: true,
          },
          where: {
            OR: [
              {
                evidenceFingerprint,
              },
              {
                evidenceType,
                sourceUrl: request.source.sourceUrl,
              },
            ],
            topicId: topic.id,
          },
        });

        if (existingEvidence) {
          evidenceId = existingEvidence.id;
        } else {
          const evidence = await transaction.topicEvidence.create({
            data: {
              collectedAt: request.source.collectedAt
                ? new Date(request.source.collectedAt)
                : new Date(),
              evidenceFingerprint,
              evidenceType,
              excerpt: request.source.excerpt,
              externalId: request.externalId,
              metadata: request.source.metadata
                ? asInputJson(request.source.metadata)
                : undefined,
              sourceConfigId: request.source.sourceConfigId,
              sourceTitle: request.source.sourceTitle,
              sourceUrl: request.source.sourceUrl,
              topicId: topic.id,
            },
          });

          evidenceCreated = true;
          evidenceId = evidence.id;
        }
      }

      const result: TopicIntakeResult = {
        evidenceCreated,
        evidenceId,
        idempotentReplay: false,
        matchedExistingTopic: !topicCreated,
        status: topic.status.toLowerCase(),
        topicCreated,
        topicId: topic.id,
      };
      const httpStatus = topicCreated ? 201 : 200;

      await transaction.auditLog.createMany({
        data: [
          {
            action: topicCreated
              ? "topic.intake.created"
              : "topic.intake.matched_existing",
            entityId: topic.id,
            entityType: "topic",
            newValue: asInputJson({
              correlationId,
              normalizedTitle,
              siteId: request.siteId,
            }),
          },
          ...(request.source
            ? [
                {
                  action: evidenceCreated
                    ? "topic.evidence.created"
                    : "topic.evidence.duplicate_ignored",
                  entityId: evidenceId ?? topic.id,
                  entityType: "topic_evidence",
                  newValue: asInputJson({
                    correlationId,
                    evidenceType: request.source.evidenceType,
                    sourceConfigId: request.source.sourceConfigId ?? null,
                    topicId: topic.id,
                  }),
                },
              ]
            : []),
        ],
      });

      await transaction.intakeIdempotencyRecord.update({
        data: {
          evidenceId,
          responseBody: asInputJson(result),
          responseStatus: httpStatus,
          topicId: topic.id,
        },
        where: {
          id: idempotencyRecord.id,
        },
      });

      return {
        httpStatus,
        result,
      };
    },
    {
      isolationLevel: "Serializable",
      maxWait: 5_000,
      timeout: 15_000,
    },
  );
}

export async function processTopicIntake(
  options: ProcessTopicIntakeOptions,
): Promise<ProcessTopicIntakeResponse> {
  const scope = idempotencyScope(options.request.siteId);
  const requestHash = hashTopicIntakeRequest(options.request);

  const replay = await resolveExistingIdempotencyRecord(
    options.database,
    scope,
    options.request.idempotencyKey,
    requestHash,
  );

  if (replay) {
    return replay;
  }

  for (let attempt = 1; attempt <= maximumTransactionAttempts; attempt += 1) {
    try {
      return await processInTransaction(options);
    } catch (error) {
      if (!isRetryableTransactionError(error)) {
        throw error;
      }

      const concurrentResult = await resolveExistingIdempotencyRecord(
        options.database,
        scope,
        options.request.idempotencyKey,
        requestHash,
      );

      if (concurrentResult) {
        return concurrentResult;
      }

      if (attempt === maximumTransactionAttempts) {
        throw error;
      }

      await new Promise((resolve) => {
        setTimeout(resolve, attempt * 10);
      });
    }
  }

  throw new Error("The topic intake transaction could not be completed.");
}
