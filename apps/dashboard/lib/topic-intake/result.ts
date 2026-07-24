export interface TopicIntakeResult {
  evidenceCreated: boolean;
  evidenceId: string | null;
  idempotentReplay: boolean;
  matchedExistingTopic: boolean;
  status: string;
  topicCreated: boolean;
  topicId: string;
}

export interface TopicIntakeSuccessResponse {
  data: TopicIntakeResult;
  success: true;
}

export function createTopicIntakeSuccessResponse(
  result: TopicIntakeResult,
): TopicIntakeSuccessResponse {
  return {
    data: result,
    success: true,
  };
}
