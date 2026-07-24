import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { getDatabaseClient } from "@ai-publishing-os/database";
import { config } from "dotenv";

config({
  path: resolve(process.cwd(), "apps/dashboard/.env.local"),
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL;
const internalApiKey = process.env.INTERNAL_API_KEY;
const baseUrl =
  process.env.TOPIC_INTAKE_BASE_URL?.replace(/\/+$/u, "") ??
  "http://localhost:3000";

if (!databaseUrl || !internalApiKey) {
  throw new Error("DATABASE_URL and INTERNAL_API_KEY are required.");
}

const database = getDatabaseClient(databaseUrl);
const runToken = randomUUID().replaceAll("-", "");
const idempotencyKey = `direct-smoke-${runToken}`;
let siteId: string | undefined;

async function submit(body: unknown, key?: string) {
  return fetch(`${baseUrl}/api/internal/topic-intake`, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "X-API-Key": key } : {}),
    },
    method: "POST",
  });
}

function assertStatus(label: string, response: Response, expected: number) {
  if (response.status !== expected) {
    throw new Error(
      `${label}: expected HTTP ${expected}, received ${response.status}.`,
    );
  }

  process.stdout.write(`PASS ${label}: HTTP ${response.status}\n`);
}

async function main() {
  try {
    const site = await database.site.create({
      data: {
        domain: `direct-smoke-${runToken}.example.test`,
        name: "Direct topic-intake smoke test",
      },
    });
    siteId = site.id;

    const payload = {
      description: "Direct endpoint smoke-test topic",
      idempotencyKey,
      siteId,
      source: {
        evidenceType: "manual",
        sourceTitle: "n8n documentation",
        sourceUrl: "https://docs.n8n.io/",
      },
      title: `Direct topic intake smoke ${runToken}`,
    };

    const missingAuthentication = await submit(payload);
    assertStatus("missing authentication", missingAuthentication, 401);
    const missingAuthenticationBody = await missingAuthentication.text();

    const invalidAuthentication = await submit(payload, "invalid-key");
    assertStatus("invalid authentication", invalidAuthentication, 401);

    if ((await invalidAuthentication.text()) !== missingAuthenticationBody) {
      throw new Error(
        "Missing and invalid authentication responses do not match.",
      );
    }

    const invalidPayload = await submit(
      {
        ...payload,
        status: "published",
      },
      internalApiKey,
    );
    assertStatus("invalid payload", invalidPayload, 400);

    const created = await submit(payload, internalApiKey);
    assertStatus("new topic creation", created, 201);
    const createdBody = (await created.json()) as {
      data: {
        evidenceId: string;
        topicId: string;
      };
    };

    const replay = await submit(payload, internalApiKey);
    assertStatus("idempotent replay", replay, 200);
    const replayBody = (await replay.json()) as {
      data: {
        idempotentReplay: boolean;
        topicId: string;
      };
    };

    if (
      !replayBody.data.idempotentReplay ||
      replayBody.data.topicId !== createdBody.data.topicId
    ) {
      throw new Error("Replay did not return the original topic result.");
    }

    const conflict = await submit(
      {
        ...payload,
        title: `${payload.title} changed`,
      },
      internalApiKey,
    );
    assertStatus("idempotency conflict", conflict, 409);

    const matched = await submit(
      {
        ...payload,
        idempotencyKey: `${idempotencyKey}-match`,
        source: {
          evidenceType: "manual",
          sourceTitle: "Second source",
          sourceUrl: "https://example.com/second-source",
        },
        title: `  ${payload.title.toUpperCase()}? `,
      },
      internalApiKey,
    );
    assertStatus("duplicate topic match", matched, 200);
    const matchedBody = (await matched.json()) as {
      data: {
        matchedExistingTopic: boolean;
        topicId: string;
      };
    };

    if (
      !matchedBody.data.matchedExistingTopic ||
      matchedBody.data.topicId !== createdBody.data.topicId
    ) {
      throw new Error("Normalized duplicate did not match the original topic.");
    }
  } finally {
    if (siteId) {
      const topics = await database.topic.findMany({
        select: {
          evidence: {
            select: {
              id: true,
            },
          },
          id: true,
        },
        where: {
          siteId,
        },
      });
      const entityIds = topics.flatMap((topic) => [
        topic.id,
        ...topic.evidence.map((evidence) => evidence.id),
      ]);

      await database.auditLog.deleteMany({
        where: {
          entityId: {
            in: entityIds,
          },
        },
      });
      await database.intakeIdempotencyRecord.deleteMany({
        where: {
          scope: `topic-intake:${siteId}:internal-api`,
        },
      });
      await database.site.deleteMany({
        where: {
          id: siteId,
        },
      });
    }

    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Unknown smoke-test failure"}\n`,
  );
  process.exitCode = 1;
});
