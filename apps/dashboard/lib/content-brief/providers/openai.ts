import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import { contentBriefProviderOutputSchema } from "@ai-publishing-os/schemas";

import { ContentBriefError } from "../errors";
import type {
  BriefProvider,
  BriefProviderInput,
  BriefProviderResult,
} from "../types";
import { validateBriefOutput } from "../validation";
import {
  buildContentBriefPrompt,
  contentBriefSystemInstructions,
} from "./prompt";

export interface OpenAiBriefProviderOptions {
  apiKey: string;
  client?: OpenAI;
  maximumOutputTokens: number;
  model: string;
  retryDelaysMs?: readonly number[];
}

function isTemporaryError(error: unknown): boolean {
  const status =
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : null;
  return status === 408 || status === 429 || Boolean(status && status >= 500);
}

export class OpenAiBriefProvider implements BriefProvider {
  readonly model: string;
  readonly name = "openai";
  private readonly client: OpenAI;
  private readonly maximumOutputTokens: number;
  private readonly retryDelaysMs: readonly number[];

  constructor(options: OpenAiBriefProviderOptions) {
    this.client =
      options.client ?? new OpenAI({ apiKey: options.apiKey, maxRetries: 0 });
    this.maximumOutputTokens = options.maximumOutputTokens;
    this.model = options.model;
    this.retryDelaysMs = options.retryDelaysMs ?? [500];
  }

  async generate(input: BriefProviderInput): Promise<BriefProviderResult> {
    const prompt = buildContentBriefPrompt(input);
    let repairRequested = false;
    let temporaryAttempts = 0;
    for (;;) {
      try {
        const response = await this.client.responses.create({
          input: repairRequested
            ? `${prompt}\nThe prior response failed schema or provenance validation. Return one corrected object without adding identifiers.`
            : prompt,
          instructions: contentBriefSystemInstructions,
          max_output_tokens: this.maximumOutputTokens,
          model: this.model,
          store: false,
          text: {
            format: zodTextFormat(
              contentBriefProviderOutputSchema,
              "content_brief",
            ),
          },
        });
        let raw: unknown;
        try {
          raw = JSON.parse(response.output_text);
        } catch {
          if (!repairRequested) {
            repairRequested = true;
            continue;
          }
          throw new ContentBriefError(
            "ai_invalid_output",
            "OpenAI returned malformed structured brief output.",
            502,
          );
        }
        try {
          return {
            output: validateBriefOutput(raw, input.snapshot, {
              maximumOutlineSections: input.maximumOutlineSections,
            }),
            usage: {
              estimatedCostUsd: null,
              inputTokens: response.usage?.input_tokens ?? null,
              outputTokens: response.usage?.output_tokens ?? null,
            },
          };
        } catch (error) {
          if (
            error instanceof ContentBriefError &&
            error.code === "ai_invalid_output" &&
            !repairRequested
          ) {
            repairRequested = true;
            continue;
          }
          throw error;
        }
      } catch (error) {
        if (error instanceof ContentBriefError) throw error;
        if (
          isTemporaryError(error) &&
          temporaryAttempts < this.retryDelaysMs.length
        ) {
          const delay = this.retryDelaysMs[temporaryAttempts++];
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new ContentBriefError(
          isTemporaryError(error) ? "ai_rate_limited" : "ai_provider_failed",
          "OpenAI could not produce a structured content brief.",
          502,
          isTemporaryError(error),
        );
      }
    }
  }
}
