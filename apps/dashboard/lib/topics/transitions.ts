import {
  TopicStatus,
  type Prisma,
  type PrismaClient,
} from "@ai-publishing-os/database";

const allowedTransitions: Readonly<
  Partial<Record<TopicStatus, readonly TopicStatus[]>>
> = {
  [TopicStatus.CANDIDATE]: [TopicStatus.REVIEWING, TopicStatus.REJECTED],
  [TopicStatus.REVIEWING]: [TopicStatus.APPROVED, TopicStatus.REJECTED],
  [TopicStatus.APPROVED]: [TopicStatus.RESEARCHING, TopicStatus.REJECTED],
  [TopicStatus.RESEARCHING]: [TopicStatus.BRIEF_READY, TopicStatus.FAILED],
  [TopicStatus.BRIEF_READY]: [TopicStatus.DRAFTING, TopicStatus.FAILED],
  [TopicStatus.DRAFTING]: [TopicStatus.QUALITY_REVIEW, TopicStatus.FAILED],
  [TopicStatus.QUALITY_REVIEW]: [
    TopicStatus.DRAFTING,
    TopicStatus.AWAITING_APPROVAL,
    TopicStatus.FAILED,
  ],
  [TopicStatus.AWAITING_APPROVAL]: [
    TopicStatus.DRAFTING,
    TopicStatus.APPROVED_FOR_PUBLISHING,
    TopicStatus.REJECTED,
  ],
  [TopicStatus.APPROVED_FOR_PUBLISHING]: [
    TopicStatus.PUBLISHED,
    TopicStatus.FAILED,
  ],
  [TopicStatus.FAILED]: [TopicStatus.APPROVED],
};

export class TopicTransitionError extends Error {
  constructor(
    readonly from: TopicStatus,
    readonly to: TopicStatus,
  ) {
    super(`Topic cannot transition from ${from} to ${to}.`);
    this.name = "TopicTransitionError";
  }
}

export function canTransitionTopicStatus(
  from: TopicStatus,
  to: TopicStatus,
): boolean {
  return allowedTransitions[from]?.includes(to) ?? false;
}

type TopicTransitionDatabase = Prisma.TransactionClient | PrismaClient;

export async function transitionTopicStatus(
  database: TopicTransitionDatabase,
  topicId: string,
  from: TopicStatus,
  to: TopicStatus,
): Promise<void> {
  if (!canTransitionTopicStatus(from, to)) {
    throw new TopicTransitionError(from, to);
  }

  const result = await database.topic.updateMany({
    data: { status: to },
    where: { id: topicId, status: from },
  });

  if (result.count !== 1) {
    throw new TopicTransitionError(from, to);
  }
}
