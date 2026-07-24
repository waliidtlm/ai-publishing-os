import {
  researchProviderOutputSchema,
  type ResearchProviderOutput,
} from "@ai-publishing-os/schemas";

import { ResearchError } from "../errors";
import { normalizeResearchText } from "../sanitize";

export function validateResearchProviderOutput(
  value: unknown,
  sourceText: string,
  limits: {
    maximumClaims: number;
    maximumExcerptCharacters: number;
  },
): ResearchProviderOutput {
  const parsed = researchProviderOutputSchema.safeParse(value);

  if (!parsed.success) {
    throw new ResearchError(
      "ai_invalid_output",
      "The research provider returned invalid structured output.",
      502,
    );
  }

  if (parsed.data.keyClaims.length > limits.maximumClaims) {
    throw new ResearchError(
      "ai_invalid_output",
      "The research provider returned too many claims.",
      502,
    );
  }

  const normalizedSource =
    normalizeResearchText(sourceText).toLocaleLowerCase();

  for (const claim of parsed.data.keyClaims) {
    if (
      Array.from(claim.supportingExcerpt).length >
        limits.maximumExcerptCharacters ||
      !normalizedSource.includes(
        normalizeResearchText(claim.supportingExcerpt).toLocaleLowerCase(),
      )
    ) {
      throw new ResearchError(
        "ai_invalid_output",
        "A research claim was not supported by the supplied source text.",
        502,
      );
    }
  }

  return parsed.data;
}
