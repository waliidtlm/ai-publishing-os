import {
  expr,
  newCredential,
  nextBatch,
  node,
  splitInBatches,
  sticky,
  trigger,
  workflow,
} from "@n8n/workflow-sdk";

const manualTestTrigger = trigger({
  type: "n8n-nodes-base.manualTrigger",
  version: 1,
  config: {
    name: "Manual Test Trigger",
    position: [0, 200],
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
            triggerAtHour: 2,
            triggerAtMinute: 0,
          },
        ],
      },
    },
  },
  output: [{}],
});

const configureResearchRun = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Configure Research Run",
    position: [260, 300],
    parameters: {
      assignments: {
        assignments: [
          {
            id: "topic-id",
            name: "topicId",
            type: "string",
            value: expr("{{ $env.RESEARCH_TOPIC_ID }}"),
          },
          {
            id: "research-mode",
            name: "mode",
            type: "string",
            value: expr('{{ $env.RESEARCH_MODE || "deterministic" }}'),
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
      topicId: "replace-with-approved-topic-id",
      triggerType: "n8n",
    },
  ],
});

const createResearchJobNode = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Create Research Job",
    position: [520, 300],
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
            neverError: false,
            responseFormat: "json",
          },
        },
        timeout: 15_000,
      },
      sendBody: true,
      specifyBody: "json",
      url: expr(
        "{{ $env.AI_PUBLISHING_OS_BASE_URL + '/api/internal/topics/' + $json.topicId + '/research-jobs' }}",
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
          job: { id: "research-job-id", status: "running" },
          sources: [
            {
              canonicalUrl: "https://example.com/article",
              evidenceId: "evidence-id",
              selectionRank: 0,
              sourceConfigId: null,
              sourceTitle: "Example",
              sourceUrl: "https://example.com/article",
            },
          ],
        },
        success: true,
      },
      statusCode: 201,
    },
  ],
});

const splitSelectedSources = node({
  type: "n8n-nodes-base.splitOut",
  version: 1,
  config: {
    name: "Split Selected Sources",
    position: [780, 300],
    parameters: {
      fieldToSplitOut: "body.data.sources",
      include: "noOtherFields",
      options: {
        destinationFieldName: "source",
      },
    },
  },
  output: [
    {
      source: {
        id: "research-job-source-id",
        sourceUrl: "https://example.com/article",
      },
    },
  ],
});

const processSourcesSequentially = splitInBatches({
  version: 3,
  config: {
    name: "Process Sources Sequentially",
    position: [1040, 300],
    parameters: {
      batchSize: 1,
      options: {
        reset: false,
      },
    },
  },
});

const processOneSource = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Process One Source",
    position: [1300, 440],
    parameters: {
      authentication: "genericCredentialType",
      contentType: "json",
      genericAuthType: "httpHeaderAuth",
      jsonBody: expr("{{ { sourceId: $json.source.id } }}"),
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
        "{{ $env.AI_PUBLISHING_OS_BASE_URL + '/api/internal/research-jobs/' + $('Create Research Job').first().json.body.data.job.id + '/process-source' }}",
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
          sourceId: "research-job-source-id",
          status: "succeeded",
        },
        success: true,
      },
      statusCode: 200,
    },
  ],
});

const completeResearchJobNode = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Complete Research Job",
    executeOnce: true,
    position: [1300, 180],
    parameters: {
      authentication: "genericCredentialType",
      contentType: "json",
      genericAuthType: "httpHeaderAuth",
      jsonBody: expr("{{ {} }}"),
      method: "POST",
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
      sendBody: true,
      specifyBody: "json",
      url: expr(
        "{{ $env.AI_PUBLISHING_OS_BASE_URL + '/api/internal/research-jobs/' + $('Create Research Job').first().json.body.data.job.id + '/complete' }}",
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
          completedAt: "2026-07-24T12:00:00.000Z",
          failedSourceCount: 0,
          generatedNoteCount: 1,
          id: "research-job-id",
          status: "COMPLETED",
          successfulSourceCount: 1,
        },
        success: true,
      },
      statusCode: 200,
    },
  ],
});

const presentResearchSummary = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Present Research Summary",
    position: [1560, 180],
    parameters: {
      assignments: {
        assignments: [
          {
            id: "job-id",
            name: "researchJobId",
            type: "string",
            value: expr("{{ $json.body.data.id }}"),
          },
          {
            id: "status",
            name: "status",
            type: "string",
            value: expr("{{ $json.body.data.status }}"),
          },
          {
            id: "notes",
            name: "generatedNoteCount",
            type: "number",
            value: expr("{{ $json.body.data.generatedNoteCount }}"),
          },
          {
            id: "successful",
            name: "successfulSourceCount",
            type: "number",
            value: expr("{{ $json.body.data.successfulSourceCount }}"),
          },
          {
            id: "failed",
            name: "failedSourceCount",
            type: "number",
            value: expr("{{ $json.body.data.failedSourceCount }}"),
          },
          {
            id: "completed-at",
            name: "completedAt",
            type: "string",
            value: expr("{{ $json.body.data.completedAt }}"),
          },
        ],
      },
      includeOtherFields: false,
      mode: "manual",
    },
  },
  output: [
    {
      completedAt: "2026-07-24T12:00:00.000Z",
      failedSourceCount: 0,
      generatedNoteCount: 1,
      researchJobId: "research-job-id",
      status: "COMPLETED",
      successfulSourceCount: 1,
    },
  ],
});

const setupNote = sticky(
  "## Setup\nSet `AI_PUBLISHING_OS_BASE_URL`, `RESEARCH_TOPIC_ID`, and optional `RESEARCH_MODE` in n8n. Configure the **AI Publishing OS Internal API** Header Auth credential with header `X-API-Key`. The export contains no secret.",
  [configureResearchRun, createResearchJobNode],
  { color: 5 },
);

const securityNote = sticky(
  "## Security boundary\nThe application selects URLs and owns DNS/redirect validation, SSRF defenses, fetching, extraction, sanitization, prompt-injection mitigation, AI calls, validation, and persistence. n8n only orchestrates bounded API calls.",
  [splitSelectedSources, processSourcesSequentially, processOneSource],
  { color: 7 },
);

const scheduleNote = sticky(
  "## Schedule disabled\nThe daily trigger is intentionally disabled. Test manually first. If enabled later, ensure the interval exceeds the worst-case run time; database constraints prevent a duplicate active job.",
  [disabledDailySchedule],
  { color: 3 },
);

const researchChain = configureResearchRun
  .to(createResearchJobNode)
  .to(splitSelectedSources)
  .to(
    processSourcesSequentially
      .onEachBatch(processOneSource.to(nextBatch(processSourcesSequentially)))
      .onDone(completeResearchJobNode.to(presentResearchSummary)),
  );

export default workflow(
  "ai-publishing-os-research-engine",
  "AI Publishing OS - Research Engine",
)
  .add(manualTestTrigger)
  .to(researchChain)
  .add(disabledDailySchedule)
  .to(researchChain)
  .add(setupNote)
  .add(securityNote)
  .add(scheduleNote);
