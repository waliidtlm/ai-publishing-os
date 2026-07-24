import { describe, expect, it } from "vitest";

import { createTopicIntakeSuccessResponse } from "../lib/topic-intake/result";

describe("createTopicIntakeSuccessResponse", () => {
  it("maps an intake result to the structured API envelope", () => {
    const result = {
      evidenceCreated: true,
      evidenceId: "clh1x2y3z0001qwertyuiopas",
      idempotentReplay: false,
      matchedExistingTopic: false,
      status: "candidate",
      topicCreated: true,
      topicId: "clh1x2y3z0002qwertyuiopas",
    };

    expect(createTopicIntakeSuccessResponse(result)).toEqual({
      data: result,
      success: true,
    });
  });
});
