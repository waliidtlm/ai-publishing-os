import OpenAI from "openai";

import { ResearchMode } from "@ai-publishing-os/database";
import { researchProviderOutputSchema } from "@ai-publishing-os/schemas";

import { ResearchError } from "../errors";
import { buildResearchPrompt, researchSystemInstructions } from "./prompt";
import type {
  ResearchProvider,
  ResearchProviderInput,
  ResearchProviderResult,
} from "./types";
import { validateResearchProviderOutput } from "./validation";

const structuredOutputJsonSchema = {
  additionalProperties: false,
  properties: {
    definitions: { items: { type: "string" }, type: "array" },
    examples: { items: { type: "string" }, type: "array" },
    keyClaims: {
      items: {
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          confidence: {
            enum: ["low", "medium", "high"],
            type: "string",
          },
          supportingExcerpt: { type: "string" },
        },
        required: ["claim", "confidence", "supportingExcerpt"],
        type: "object",
      },
      type: "array",
    },
    openQuestions: { items: { type: "string" }, type: "array" },
    risks: { items: { type: "string" }, type: "array" },
    statistics: { items: { type: "string" }, type: "array" },
    summary: { type: "string" },
  },
  required: [
    "summary",
    "keyClaims",
    "definitions",
    "statistics",
    "examples",
    "risks",
    "openQuestions",
  ],
  type: "object",
} as const;

export interface OpenAiResearchProviderOptions {
  apiKey: string;
  client?: OpenAI;
  maximumOutputTokens: number;
  model: string;
  retryDelaysMs?: readonly number[];
}

function isTemporaryOpenAiError(error: unknown): boolean {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : null;

  return (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    Boolean(status && status >= 500)
  );
}

export class OpenAiResearchProvider implements ResearchProvider {
  readonly mode = ResearchMode.OPENAI;
  readonly name = "openai";
  readonly model: string;
  private readonly client: OpenAI;
  private readonly maximumOutputTokens: number;
  private readonly retryDelaysMs: readonly number[];

  constructor(options: OpenAiResearchProviderOptions) {
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        maxRetries: 0,
      });
    this.maximumOutputTokens = options.maximumOutputTokens;
    this.model = options.model;
    this.retryDelaysMs = options.retryDelaysMs ?? [500];
  }

  async generate(
    input: ResearchProviderInput,
  ): Promise<ResearchProviderResult> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.client.responses.create({
          input: buildResearchPrompt(input),
          instructions: researchSystemInstructions,
          max_output_tokens: this.maximumOutputTokens,
          model: this.model,
          store: false,
          text: {
            format: {
              name: "research_source_notes",
              schema: structuredOutputJsonSchema,
              strict: true,
              type: "json_schema",
            },
          },
        });

        let rawOutput: unknown;

        try {
          rawOutput = JSON.parse(response.output_text);
        } catch {
          throw new ResearchError(
            "ai_invalid_output",
            "OpenAI returned malformed structured research output.",
            502,
          );
        }

        const schemaChecked = researchProviderOutputSchema.parse(rawOutput);
        const output = validateResearchProviderOutput(
          schemaChecked,
          input.sourceText,
          {
            maximumClaims: input.maximumClaims,
            maximumExcerptCharacters: input.maximumExcerptCharacters,
          },
        );

        return {
          output,
          usage: {
            estimatedCostUsd: null,
            inputTokens: response.usage?.input_tokens ?? null,
            outputTokens: response.usage?.output_tokens ?? null,
          },
        };
      } catch (error) {
        if (error instanceof ResearchError) {
          throw error;
        }

        if (
          isTemporaryOpenAiError(error) &&
          attempt < this.retryDelaysMs.length
        ) {
          await new Promise((resolve) => {
            setTimeout(resolve, this.retryDelaysMs[attempt]);
          });
          continue;
        }

        throw new ResearchError(
          isTemporaryOpenAiError(error)
            ? "ai_rate_limited"
            : "ai_provider_failed",
          "OpenAI could not produce structured research notes.",
          502,
          isTemporaryOpenAiError(error),
        );
      }
    }
  }
}
