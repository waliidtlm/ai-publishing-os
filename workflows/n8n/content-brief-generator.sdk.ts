import {
  expr,
  ifElse,
  newCredential,
  node,
  sticky,
  trigger,
  workflow,
} from "@n8n/workflow-sdk";

const manualTestTrigger = trigger({
  type: "n8n-nodes-base.manualTrigger",
  version: 1,
  config: {
    name: "Manual Test Trigger",
    position: [0, 160],
    parameters: {},
  },
  output: [{}],
});

const disabledDailySchedule = trigger({
  type: "n8n-nodes-base.scheduleTrigger",
  version: 1.3,
  config: {
    name: "Disabled Daily Schedule",
    disabled: true,
    position: [0, 420],
    parameters: {
      rule: {
        interval: [
          {
            daysInterval: 1,
            field: "days",
            triggerAtHour: 3,
            triggerAtMinute: 0,
          },
        ],
      },
    },
  },
  output: [{}],
});

const configureBriefRun = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Configure Brief Run",
    position: [260, 280],
    parameters: {
      assignments: {
        assignments: [
          {
            id: "topic-id",
            name: "topicId",
            type: "string",
            value: expr("{{ $env.CONTENT_BRIEF_TOPIC_ID }}"),
          },
          {
            id: "brief-mode",
            name: "mode",
            type: "string",
            value: expr('{{ $env.CONTENT_BRIEF_MODE || "deterministic" }}'),
          },
          {
            id: "trigger-type",
            name: "triggerType",
            type: "string",
            value: "n8n",
          },
        ],
      },
      includeOtherFields: false,
      mode: "manual",
    },
  },
  output: [
    {
      mode: "deterministic",
      topicId: "replace-with-brief-ready-topic-id",
      triggerType: "n8n",
    },
  ],
});

const createBriefJob = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Create Brief Job",
    position: [520, 280],
    parameters: {
      authentication: "genericCredentialType",
      contentType: "json",
      genericAuthType: "httpHeaderAuth",
      jsonBody: expr(
        "{{ { mode: $json.mode, triggerType: $json.triggerType, workflowExecutionReference: $execution.id } }}",
      ),
      method: "POST",
      options: {
        response: {
          response: {
            fullResponse: true,
            neverError: true,
            responseFormat: "json",
          },
        },
        timeout: 15_000,
      },
      sendBody: true,
      specifyBody: "json",
      url: expr(
        "{{ $env.AI_PUBLISHING_OS_BASE_URL + '/api/internal/topics/' + $json.topicId + '/brief-jobs' }}",
      ),
    },
    credentials: {
      httpHeaderAuth: newCredential("AI Publishing OS Internal API"),
    },
  },
  output: [
    {
      body: {
        data: {
          idempotentReplay: false,
          job: { id: "brief-job-id", status: "QUEUED" },
        },
        success: true,
      },
      statusCode: 201,
    },
  ],
});

const briefJobCreated = ifElse({
  version: 2.3,
  config: {
    name: "Brief Job Created?",
    position: [780, 280],
    parameters: {
      conditions: {
        combinator: "and",
        conditions: [
          {
            leftValue: expr("{{ $json.body.success }}"),
            operator: { operation: "true", type: "boolean" },
            rightValue: true,
          },
        ],
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
        },
      },
    },
  },
  output: [
    { body: { success: true }, statusCode: 201 },
    {
      body: {
        error: { code: "ineligible_topic", message: "Safe error" },
        success: false,
      },
      statusCode: 409,
    },
  ],
});

const generateAndPersistBrief = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Generate and Persist Brief",
    position: [1040, 180],
    parameters: {
      authentication: "genericCredentialType",
      contentType: "json",
      genericAuthType: "httpHeaderAuth",
      jsonBody: "{}",
      method: "POST",
      options: {
        response: {
          response: {
            fullResponse: true,
            neverError: true,
            responseFormat: "json",
          },
        },
        timeout: 120_000,
      },
      sendBody: true,
      specifyBody: "json",
      url: expr(
        '{{ $env.AI_PUBLISHING_OS_BASE_URL + "/api/internal/brief-jobs/" + $("Create Brief Job").item.json.body.data.job.id + "/generate" }}',
      ),
    },
    credentials: {
      httpHeaderAuth: newCredential("AI Publishing OS Internal API"),
    },
  },
  output: [
    {
      body: {
        data: {
          brief: { id: "brief-id", primaryTitle: "Working title", version: 1 },
          job: { id: "brief-job-id", status: "COMPLETED" },
        },
        success: true,
      },
      statusCode: 200,
    },
  ],
});

const briefGenerated = ifElse({
  version: 2.3,
  config: {
    name: "Brief Generated?",
    position: [1300, 180],
    parameters: {
      conditions: {
        combinator: "and",
        conditions: [
          {
            leftValue: expr("{{ $json.body.success }}"),
            operator: { operation: "true", type: "boolean" },
            rightValue: true,
          },
        ],
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
        },
      },
    },
  },
  output: [
    { body: { success: true }, statusCode: 200 },
    {
      body: {
        error: { code: "brief_generation_failed", message: "Safe error" },
        success: false,
      },
      statusCode: 422,
    },
  ],
});

const readStoredBriefJob = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Read Stored Brief Job",
    position: [1560, 80],
    parameters: {
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      method: "GET",
      options: {
        response: {
          response: {
            fullResponse: true,
            neverError: false,
            responseFormat: "json",
          },
        },
        timeout: 15_000,
      },
      url: expr(
        '{{ $env.AI_PUBLISHING_OS_BASE_URL + "/api/internal/brief-jobs/" + $("Create Brief Job").item.json.body.data.job.id }}',
      ),
    },
    credentials: {
      httpHeaderAuth: newCredential("AI Publishing OS Internal API"),
    },
  },
  output: [
    {
      body: {
        data: {
          briefs: [
            { id: "brief-id", primaryTitle: "Working title", version: 1 },
          ],
          id: "brief-job-id",
          status: "COMPLETED",
          topic: { status: "DRAFTING" },
        },
        success: true,
      },
      statusCode: 200,
    },
  ],
});

const presentBriefSummary = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Present Brief Summary",
    position: [1820, 80],
    parameters: {
      assignments: {
        assignments: [
          {
            id: "job-id",
            name: "briefJobId",
            type: "string",
            value: expr("{{ $json.body.data.id }}"),
          },
          {
            id: "brief-id",
            name: "briefId",
            type: "string",
            value: expr("{{ $json.body.data.briefs[0].id }}"),
          },
          {
            id: "version",
            name: "version",
            type: "number",
            value: expr("{{ $json.body.data.briefs[0].version }}"),
          },
          {
            id: "title",
            name: "primaryTitle",
            type: "string",
            value: expr("{{ $json.body.data.briefs[0].primaryTitle }}"),
          },
          {
            id: "topic-status",
            name: "topicStatus",
            type: "string",
            value: expr("{{ $json.body.data.topic.status }}"),
          },
        ],
      },
      includeOtherFields: false,
      mode: "manual",
    },
  },
  output: [
    {
      briefId: "brief-id",
      briefJobId: "brief-job-id",
      primaryTitle: "Working title",
      topicStatus: "DRAFTING",
      version: 1,
    },
  ],
});

const presentSafeFailure = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Present Safe Failure",
    position: [1300, 420],
    parameters: {
      assignments: {
        assignments: [
          {
            id: "success",
            name: "success",
            type: "boolean",
            value: false,
          },
          {
            id: "status-code",
            name: "statusCode",
            type: "number",
            value: expr("{{ $json.statusCode }}"),
          },
          {
            id: "error-code",
            name: "errorCode",
            type: "string",
            value: expr('{{ $json.body.error?.code || "unknown_error" }}'),
          },
          {
            id: "error-message",
            name: "errorMessage",
            type: "string",
            value: expr(
              '{{ $json.body.error?.message || "The brief workflow failed safely." }}',
            ),
          },
        ],
      },
      includeOtherFields: false,
      mode: "manual",
    },
  },
  output: [
    {
      errorCode: "ineligible_topic",
      errorMessage: "Safe error",
      statusCode: 409,
      success: false,
    },
  ],
});

const setupNote = sticky(
  "## Setup\nSet `AI_PUBLISHING_OS_BASE_URL`, `CONTENT_BRIEF_TOPIC_ID`, and optional `CONTENT_BRIEF_MODE`. Attach the **AI Publishing OS Internal API** Header Auth credential (`X-API-Key`) to all HTTP nodes. No secret is embedded.",
  [configureBriefRun, createBriefJob],
  { color: 5 },
);

const securityNote = sticky(
  "## Application security boundary\nThe application selects research, builds prompts, invokes deterministic/OpenAI providers, validates every ID and source, versions the brief, persists it, and transitions the topic. n8n only orchestrates bounded API calls.",
  [generateAndPersistBrief, readStoredBriefJob],
  { color: 7 },
);

const scheduleNote = sticky(
  "## Schedule disabled\nTest manually first. If enabled later, use an interval longer than worst-case generation time. The database prevents overlapping active jobs.",
  [disabledDailySchedule],
  { color: 3 },
);

const briefChain = configureBriefRun
  .to(createBriefJob)
  .to(
    briefJobCreated
      .onTrue(
        generateAndPersistBrief.to(
          briefGenerated
            .onTrue(readStoredBriefJob.to(presentBriefSummary))
            .onFalse(presentSafeFailure),
        ),
      )
      .onFalse(presentSafeFailure),
  );

export default workflow(
  "ai-publishing-os-content-brief-generator",
  "AI Publishing OS - Content Brief Generator",
)
  .add(manualTestTrigger)
  .to(briefChain)
  .add(disabledDailySchedule)
  .to(briefChain)
  .add(setupNote)
  .add(securityNote)
  .add(scheduleNote);
