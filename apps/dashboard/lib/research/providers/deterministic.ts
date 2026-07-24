import { ResearchMode } from "@ai-publishing-os/database";

import { normalizeResearchText, truncateResearchText } from "../sanitize";
import type {
  ResearchProvider,
  ResearchProviderInput,
  ResearchProviderResult,
} from "./types";
import { validateResearchProviderOutput } from "./validation";

function firstUsefulSentence(value: string): string {
  const normalized = normalizeResearchText(value);
  const sentence = normalized.match(/^.{40,500}?[.!?](?:\s|$)/u)?.[0];
  return sentence?.trim() || truncateResearchText(normalized, 500);
}

export class DeterministicResearchProvider implements ResearchProvider {
  readonly mode = ResearchMode.DETERMINISTIC;
  readonly model = "deterministic-extraction-v1";
  readonly name = "deterministic";

  async generate(
    input: ResearchProviderInput,
  ): Promise<ResearchProviderResult> {
    const supportingExcerpt = truncateResearchText(
      firstUsefulSentence(input.sourceText),
      input.maximumExcerptCharacters,
    );
    const output = validateResearchProviderOutput(
      {
        definitions: [],
        examples: [],
        keyClaims: supportingExcerpt
          ? [
              {
                claim: supportingExcerpt,
                confidence: "low",
                supportingExcerpt,
              },
            ]
          : [],
        openQuestions: [],
        risks: [],
        statistics: [],
        summary: truncateResearchText(
          input.description || firstUsefulSentence(input.sourceText),
          2_000,
        ),
      },
      input.sourceText,
      {
        maximumClaims: input.maximumClaims,
        maximumExcerptCharacters: input.maximumExcerptCharacters,
      },
    );

    return {
      output,
      usage: {
        estimatedCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
    };
  }
}
