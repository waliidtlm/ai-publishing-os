import {
  expr,
  ifElse,
  merge,
  newCredential,
  node,
  sticky,
  trigger,
  workflow,
} from "@n8n/workflow-sdk";

const internalCredential = newCredential("AI Publishing OS Internal API");

const manualTrigger = trigger({
  type: "n8n-nodes-base.manualTrigger",
  version: 1,
  config: { name: "Manual Test Trigger", position: [0, 200] },
  output: [{}],
});

const scheduleTrigger = trigger({
  type: "n8n-nodes-base.scheduleTrigger",
  version: 1.3,
  config: {
    name: "Every 6 Hours",
    position: [0, 420],
    parameters: {
      rule: { interval: [{ field: "hours", hoursInterval: 6 }] },
    },
  },
  output: [{}],
});

const loadSources = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Load Active RSS Sources",
    position: [260, 300],
    parameters: {
      method: "GET",
      url: expr(
        "{{ $env.AI_PUBLISHING_OS_BASE_URL + '/api/internal/sources/rss' }}",
      ),
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      options: {
        response: {
          response: {
            fullResponse: true,
            neverError: false,
            responseFormat: "json",
          },
        },
        timeout: 15000,
      },
    },
    credentials: { httpHeaderAuth: internalCredential },
  },
  output: [
    {
      statusCode: 200,
      body: {
        success: true,
        data: {
          count: 1,
          sources: [
            {
              id: "source-id",
              siteId: "site-id",
              name: "Example RSS",
              feedUrl: "https://example.com/feed.xml",
              collectionLimit: 20,
            },
          ],
        },
      },
    },
  ],
});

const splitSources = node({
  type: "n8n-nodes-base.splitOut",
  version: 1,
  config: {
    name: "Split Active Sources",
    position: [520, 300],
    parameters: {
      fieldToSplitOut: "body.data.sources",
      include: "noOtherFields",
      options: { destinationFieldName: "source" },
    },
  },
  output: [
    {
      source: {
        id: "source-id",
        siteId: "site-id",
        name: "Example RSS",
        feedUrl: "https://example.com/feed.xml",
        collectionLimit: 20,
      },
    },
  ],
});

const startCollection = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Record Collection Start",
    position: [780, 300],
    parameters: {
      method: "POST",
      url: expr(
        "{{ $env.AI_PUBLISHING_OS_BASE_URL + '/api/internal/sources/' + $json.source.id + '/collection-result' }}",
      ),
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr(
        "{{ { status: 'started', workflowExecutionId: $execution.id, startedAt: $now.toISO() } }}",
      ),
      options: {
        response: {
          response: {
            fullResponse: true,
            neverError: true,
            responseFormat: "json",
          },
        },
        timeout: 15000,
      },
    },
    credentials: { httpHeaderAuth: internalCredential },
  },
  output: [
    {
      statusCode: 201,
      body: {
        success: true,
        data: { runId: "run-id", status: "started" },
      },
    },
  ],
});

const attachRunContext = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Attach Run Context",
    position: [1040, 300],
    parameters: {
      mode: "manual",
      assignments: {
        assignments: [
          {
            id: "source-context",
            name: "source",
            type: "object",
            value: expr("{{ $('Split Active Sources').item.json.source }}"),
          },
          {
            id: "run-id",
            name: "runId",
            type: "string",
            value: expr("{{ $json.body?.data?.runId ?? '' }}"),
          },
          {
            id: "started-at",
            name: "startedAt",
            type: "string",
            value: expr("{{ $now.toISO() }}"),
          },
          {
            id: "start-ok",
            name: "startOk",
            type: "boolean",
            value: expr(
              "{{ [200, 201].includes($json.statusCode) && $json.body?.success === true }}",
            ),
          },
          {
            id: "start-error",
            name: "startError",
            type: "object",
            value: expr(
              "{{ $json.body?.error ?? { code: 'collection_start_failed', message: 'Collection start could not be recorded.' } }}",
            ),
          },
        ],
      },
      includeOtherFields: false,
    },
  },
  output: [
    {
      source: { id: "source-id" },
      runId: "run-id",
      startedAt: "2026-07-24T10:00:00.000Z",
      startOk: true,
      startError: {},
    },
  ],
});

const collectionStarted = ifElse({
  version: 2.3,
  config: {
    name: "Collection Start Recorded?",
    position: [1300, 300],
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
        },
        conditions: [
          {
            leftValue: expr("{{ $json.startOk }}"),
            operator: { type: "boolean", operation: "true" },
            rightValue: "",
          },
        ],
        combinator: "and",
      },
    },
  },
});

const fetchFeed = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Fetch Parsed Feed",
    position: [1560, 180],
    parameters: {
      method: "POST",
      url: expr(
        "{{ $env.AI_PUBLISHING_OS_BASE_URL + '/api/internal/sources/' + $json.source.id + '/fetch' }}",
      ),
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr(
        "{{ $json.source.collectionLimit ? { entryLimit: $json.source.collectionLimit } : {} }}",
      ),
      options: {
        response: {
          response: {
            fullResponse: true,
            neverError: true,
            responseFormat: "json",
          },
        },
        timeout: 70000,
      },
    },
    credentials: { httpHeaderAuth: internalCredential },
  },
  output: [
    {
      statusCode: 200,
      body: {
        success: true,
        data: {
          sourceId: "source-id",
          status: "fetched",
          entries: [],
          discoveredCount: 0,
          returnedCount: 0,
          skippedCount: 0,
          notModified: false,
        },
      },
    },
  ],
});

const attachFetchContext = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Attach Fetch Context",
    position: [1810, 180],
    parameters: {
      mode: "manual",
      assignments: {
        assignments: [
          {
            id: "fetch-context",
            name: "context",
            type: "object",
            value: expr("{{ $('Attach Run Context').item.json }}"),
          },
        ],
      },
      includeOtherFields: true,
    },
  },
  output: [
    {
      statusCode: 200,
      body: { success: true, data: { entries: [] } },
      context: {
        source: {},
        runId: "run-id",
        startedAt: "2026-07-24T10:00:00.000Z",
      },
    },
  ],
});

const prepareSourceWork = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Prepare Source Work",
    position: [2060, 180],
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode:
        "const output = [];\n" +
        "for (const item of $input.all()) {\n" +
        "  const response = item.json;\n" +
        "  const context = response.context;\n" +
        "  const data = response.body?.data;\n" +
        "  const base = { source: context.source, runId: context.runId, startedAt: context.startedAt };\n" +
        "  if (response.statusCode !== 200 || response.body?.success !== true) {\n" +
        "    output.push({ json: { ...base, kind: 'fetch_failed', fetch: { discoveredCount: 0, returnedCount: 0, skippedCount: 0, httpStatus: response.statusCode, errorCode: response.body?.error?.code ?? 'rss_fetch_failed', errorSummary: response.body?.error?.message ?? 'RSS fetch failed.' } } });\n" +
        "    continue;\n" +
        "  }\n" +
        "  const fetch = { discoveredCount: data.discoveredCount ?? 0, returnedCount: data.returnedCount ?? 0, skippedCount: data.skippedCount ?? 0, httpStatus: data.httpStatus, etag: data.etag, lastModified: data.lastModified };\n" +
        "  if (data.notModified) { output.push({ json: { ...base, kind: 'not_modified', fetch } }); continue; }\n" +
        "  const entries = Array.isArray(data.entries) ? data.entries : [];\n" +
        "  if (entries.length === 0) { output.push({ json: { ...base, kind: 'no_entries', fetch } }); continue; }\n" +
        "  for (const entry of entries) output.push({ json: { ...base, kind: 'entry', fetch, entry } });\n" +
        "}\n" +
        "return output;",
    },
  },
  output: [
    {
      kind: "entry",
      source: {
        id: "source-id",
        siteId: "site-id",
        feedUrl: "https://example.com/feed.xml",
      },
      runId: "run-id",
      startedAt: "2026-07-24T10:00:00.000Z",
      fetch: {
        discoveredCount: 1,
        returnedCount: 1,
        skippedCount: 0,
        httpStatus: 200,
      },
      entry: {
        stableId: "rss_hash",
        title: "Example",
        url: "https://example.com/article",
      },
    },
  ],
});

const isEntry = ifElse({
  version: 2.3,
  config: {
    name: "Eligible Entry?",
    position: [2310, 180],
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
        },
        conditions: [
          {
            leftValue: expr("{{ $json.kind }}"),
            operator: { type: "string", operation: "equals" },
            rightValue: "entry",
          },
        ],
        combinator: "and",
      },
    },
  },
});

const buildPayload = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Build Topic Intake Payload",
    position: [2550, 40],
    parameters: {
      mode: "manual",
      assignments: {
        assignments: [
          {
            id: "intake-payload",
            name: "intakePayload",
            type: "object",
            value: expr(
              "{{ { siteId: $json.source.siteId, title: $json.entry.title, description: $json.entry.description || undefined, externalId: $json.entry.stableId, idempotencyKey: 'rss:' + $json.source.id + ':' + $json.entry.stableId, metadata: { collector: 'rss', feedUrl: $json.source.feedUrl, publishedAt: $json.entry.publishedAt }, source: { sourceConfigId: $json.source.id, evidenceType: 'source', sourceUrl: $json.entry.url, sourceTitle: $json.entry.title, excerpt: $json.entry.excerpt || undefined, collectedAt: $now.toISO(), metadata: { feedEntryId: $json.entry.feedEntryId, author: $json.entry.author, publishedAt: $json.entry.publishedAt, updatedAt: $json.entry.updatedAt } } } }}",
            ),
          },
        ],
      },
      includeOtherFields: true,
    },
  },
  output: [
    {
      kind: "entry",
      source: { id: "source-id" },
      runId: "run-id",
      intakePayload: { siteId: "site-id", title: "Example" },
    },
  ],
});

const submitIntake = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Submit Topic Intake",
    position: [2790, 40],
    parameters: {
      method: "POST",
      url: expr(
        "{{ $env.AI_PUBLISHING_OS_BASE_URL + '/api/internal/topic-intake' }}",
      ),
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr("{{ $json.intakePayload }}"),
      options: {
        response: {
          response: {
            fullResponse: true,
            neverError: true,
            responseFormat: "json",
          },
        },
        timeout: 20000,
      },
    },
    credentials: { httpHeaderAuth: internalCredential },
  },
  output: [
    {
      statusCode: 201,
      body: {
        success: true,
        data: { topicCreated: true, matchedExistingTopic: false },
      },
    },
  ],
});

const temporaryFailure = ifElse({
  version: 2.3,
  config: {
    name: "Temporary Intake Failure?",
    position: [3030, 40],
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: "",
          typeValidation: "strict",
        },
        conditions: [
          {
            leftValue: expr("{{ $json.statusCode }}"),
            operator: { type: "number", operation: "equals" },
            rightValue: 429,
          },
          {
            leftValue: expr("{{ $json.statusCode }}"),
            operator: { type: "number", operation: "equals" },
            rightValue: 502,
          },
          {
            leftValue: expr("{{ $json.statusCode }}"),
            operator: { type: "number", operation: "equals" },
            rightValue: 503,
          },
          {
            leftValue: expr("{{ $json.statusCode }}"),
            operator: { type: "number", operation: "equals" },
            rightValue: 504,
          },
        ],
        combinator: "or",
      },
    },
  },
});

const retryDelay = node({
  type: "n8n-nodes-base.wait",
  version: 1.1,
  config: {
    name: "Retry Delay",
    position: [3260, -80],
    parameters: {
      resume: "timeInterval",
      amount: 2,
      unit: "seconds",
    },
  },
  output: [{ statusCode: 503 }],
});

const retryIntake = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Retry Temporary Intake",
    position: [3480, -80],
    parameters: {
      method: "POST",
      url: expr(
        "{{ $env.AI_PUBLISHING_OS_BASE_URL + '/api/internal/topic-intake' }}",
      ),
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr(
        "{{ $('Build Topic Intake Payload').item.json.intakePayload }}",
      ),
      options: {
        response: {
          response: {
            fullResponse: true,
            neverError: true,
            responseFormat: "json",
          },
        },
        timeout: 20000,
      },
    },
    credentials: { httpHeaderAuth: internalCredential },
  },
  output: [
    {
      statusCode: 200,
      body: {
        success: true,
        data: { topicCreated: false, matchedExistingTopic: true },
      },
    },
  ],
});

const mergeAttempts = merge({
  version: 3.2,
  config: {
    name: "Merge Intake Attempts",
    position: [3720, 40],
    parameters: { mode: "append", numberInputs: 2 },
  },
});

const attachIntakeContext = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Attach Intake Context",
    position: [3940, 40],
    parameters: {
      mode: "manual",
      assignments: {
        assignments: [
          {
            id: "intake-context",
            name: "work",
            type: "object",
            value: expr("{{ $('Build Topic Intake Payload').item.json }}"),
          },
        ],
      },
      includeOtherFields: true,
    },
  },
  output: [
    {
      statusCode: 200,
      body: { success: true },
      work: { source: {}, runId: "run-id" },
    },
  ],
});

const normalizeIntake = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Normalize Intake Outcome",
    position: [4160, 40],
    parameters: {
      mode: "runOnceForEachItem",
      language: "javaScript",
      jsCode:
        "const work = $json.work;\n" +
        "const success = [200, 201].includes($json.statusCode) && $json.body?.success === true;\n" +
        "return { json: { source: work.source, runId: work.runId, startedAt: work.startedAt, fetch: work.fetch, kind: 'intake_result', intakeSuccess: success, matched: success && $json.body.data?.matchedExistingTopic === true, errorSummary: success ? null : ($json.body?.error?.message ?? 'Topic Intake failed.'), intakeStatus: $json.statusCode } };",
    },
  },
  output: [
    {
      kind: "intake_result",
      source: { id: "source-id" },
      runId: "run-id",
      intakeSuccess: true,
      matched: false,
    },
  ],
});

const normalizeSourceOutcome = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Normalize Source Outcome",
    position: [2550, 300],
    parameters: {
      mode: "runOnceForEachItem",
      language: "javaScript",
      jsCode:
        "return { json: { source: $json.source, runId: $json.runId, startedAt: $json.startedAt, fetch: $json.fetch, kind: $json.kind } };",
    },
  },
  output: [
    {
      kind: "not_modified",
      source: { id: "source-id" },
      runId: "run-id",
    },
  ],
});

const mergeOutcomes = merge({
  version: 3.2,
  config: {
    name: "Merge Source Outcomes",
    position: [4400, 180],
    parameters: { mode: "append", numberInputs: 2 },
  },
});

const aggregateResults = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Aggregate Collection Results",
    position: [4640, 180],
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode:
        "const groups = new Map();\n" +
        "for (const { json } of $input.all()) {\n" +
        "  const id = json.source.id;\n" +
        "  if (!groups.has(id)) groups.set(id, { source: json.source, runId: json.runId, startedAt: json.startedAt, fetch: json.fetch, acceptedCount: 0, matchedCount: 0, submittedCount: 0, failedCount: 0, kinds: new Set(), errorSummary: null });\n" +
        "  const group = groups.get(id);\n" +
        "  group.kinds.add(json.kind);\n" +
        "  if (json.kind === 'intake_result') { group.submittedCount += 1; if (json.intakeSuccess) { group.acceptedCount += 1; if (json.matched) group.matchedCount += 1; } else { group.failedCount += 1; group.errorSummary ??= json.errorSummary; } }\n" +
        "}\n" +
        "return [...groups.values()].map((group) => {\n" +
        "  let status = 'succeeded'; let errorCode; let errorSummary = group.errorSummary;\n" +
        "  if (group.kinds.has('fetch_failed')) { status = 'failed'; errorCode = group.fetch.errorCode; errorSummary = group.fetch.errorSummary; }\n" +
        "  else if (group.kinds.has('not_modified')) status = 'not_modified';\n" +
        "  else if (group.failedCount > 0 && group.acceptedCount > 0) { status = 'partial'; errorCode = 'topic_intake_partial_failure'; }\n" +
        "  else if (group.failedCount > 0) { status = 'failed'; errorCode = 'topic_intake_failed'; }\n" +
        "  const result = { runId: group.runId, status, discoveredCount: group.fetch.discoveredCount ?? 0, returnedCount: group.fetch.returnedCount ?? 0, submittedCount: group.submittedCount, acceptedCount: group.acceptedCount, matchedCount: group.matchedCount, skippedCount: group.fetch.skippedCount ?? 0, failedCount: group.failedCount, durationMs: Math.max(0, Date.now() - Date.parse(group.startedAt)), httpStatus: group.fetch.httpStatus, ...(group.fetch.etag ? { etag: group.fetch.etag } : {}), ...(group.fetch.lastModified ? { lastModified: group.fetch.lastModified } : {}), ...(errorCode ? { errorCode } : {}), ...(errorSummary ? { errorSummary: String(errorSummary).slice(0, 500) } : {}) };\n" +
        "  return { json: { source: group.source, collectionResult: result } };\n" +
        "});",
    },
  },
  output: [
    {
      source: { id: "source-id" },
      collectionResult: {
        runId: "run-id",
        status: "succeeded",
        discoveredCount: 1,
        returnedCount: 1,
        submittedCount: 1,
        acceptedCount: 1,
        matchedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        durationMs: 100,
        httpStatus: 200,
      },
    },
  ],
});

const recordResult = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Record Final Collection Result",
    position: [4880, 180],
    parameters: {
      method: "POST",
      url: expr(
        "{{ $env.AI_PUBLISHING_OS_BASE_URL + '/api/internal/sources/' + $json.source.id + '/collection-result' }}",
      ),
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr("{{ $json.collectionResult }}"),
      options: {
        response: {
          response: {
            fullResponse: true,
            neverError: true,
            responseFormat: "json",
          },
        },
        timeout: 15000,
      },
    },
    credentials: { httpHeaderAuth: internalCredential },
  },
  output: [
    {
      statusCode: 200,
      body: {
        success: true,
        data: {
          sourceId: "source-id",
          runId: "run-id",
          status: "succeeded",
        },
      },
    },
  ],
});

const normalizeStartFailure = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Report Unrecorded Start Failure",
    position: [1560, 440],
    parameters: {
      mode: "runOnceForEachItem",
      language: "javaScript",
      jsCode:
        "return { json: { unrecorded: true, sourceId: $json.source.id, sourceName: $json.source.name, status: 'start_failed', error: $json.startError?.message ?? 'Collection start could not be recorded.' } };",
    },
  },
  output: [{ unrecorded: true, sourceId: "source-id", status: "start_failed" }],
});

const mergeCompletions = merge({
  version: 3.2,
  config: {
    name: "Merge Completed Sources",
    position: [5120, 300],
    parameters: { mode: "append", numberInputs: 2 },
  },
});

const finalSummary = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Show Run Summary",
    position: [5360, 300],
    executeOnce: true,
    parameters: {
      mode: "runOnceForAllItems",
      language: "javaScript",
      jsCode:
        "const items = $input.all().map((item) => item.json);\n" +
        "return [{ json: { completedAt: new Date().toISOString(), sourceCount: items.length, recordedCount: items.filter((item) => item.body?.success === true).length, unrecordedCount: items.filter((item) => item.unrecorded).length, sources: items.map((item) => item.unrecorded ? item : item.body?.data ?? { status: 'result_recording_failed', httpStatus: item.statusCode }) } }];",
    },
  },
  output: [
    {
      completedAt: "2026-07-24T10:05:00.000Z",
      sourceCount: 1,
      recordedCount: 1,
      unrecordedCount: 0,
      sources: [],
    },
  ],
});

const startNote = sticky(
  "## Setup\nSet `AI_PUBLISHING_OS_BASE_URL` in n8n. Configure the **AI Publishing OS Internal API** HTTP Header Auth credential with header `X-API-Key`. The workflow export contains no secret.",
  [manualTrigger, scheduleTrigger, loadSources],
  { color: 5 },
);
const securityNote = sticky(
  "## Security boundary\nThe application fetch endpoint owns URL/DNS/redirect validation, SSRF defenses, timeouts, response limits, XML safety, caching, parsing, and sanitization. n8n never sends its credential to a feed host.",
  [fetchFeed, prepareSourceWork],
  { color: 3 },
);
const behaviorNote = sticky(
  "## Failure behavior\nFetch and intake errors become counted outcomes. Temporary Topic Intake failures receive one delayed retry. One entry or source failure does not stop unrelated items.",
  [temporaryFailure, retryDelay, aggregateResults, recordResult],
  { color: 6 },
);

export default workflow(
  "ai-publishing-os-rss-collector",
  "AI Publishing OS - RSS Collector",
)
  .add(manualTrigger)
  .to(loadSources)
  .to(splitSources)
  .to(startCollection)
  .to(attachRunContext)
  .to(
    collectionStarted
      .onTrue(
        fetchFeed
          .to(attachFetchContext)
          .to(prepareSourceWork)
          .to(
            isEntry
              .onTrue(
                buildPayload
                  .to(submitIntake)
                  .to(
                    temporaryFailure
                      .onTrue(
                        retryDelay.to(retryIntake).to(mergeAttempts.input(0)),
                      )
                      .onFalse(mergeAttempts.input(1)),
                  ),
              )
              .onFalse(normalizeSourceOutcome.to(mergeOutcomes.input(1))),
          ),
      )
      .onFalse(normalizeStartFailure.to(mergeCompletions.input(1))),
  )
  .add(scheduleTrigger)
  .to(loadSources)
  .add(mergeAttempts)
  .to(attachIntakeContext)
  .to(normalizeIntake)
  .to(mergeOutcomes.input(0))
  .add(mergeOutcomes)
  .to(aggregateResults)
  .to(recordResult)
  .to(mergeCompletions.input(0))
  .add(mergeCompletions)
  .to(finalSummary)
  .add(startNote)
  .add(securityNote)
  .add(behaviorNote);
