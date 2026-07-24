import type { ResearchMode } from "@ai-publishing-os/database";
import type { ResearchProviderOutput } from "@ai-publishing-os/schemas";

export interface ResearchProviderInput {
  author: string | null;
  description: string | null;
  headings: readonly string[];
  maximumClaims: number;
  maximumExcerptCharacters: number;
  sourceText: string;
  sourceTitle: string;
  sourceUrl: string;
  topicDescription: string | null;
  topicTitle: string;
}

export interface ResearchProviderUsage {
  estimatedCostUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ResearchProviderResult {
  output: ResearchProviderOutput;
  usage: ResearchProviderUsage;
}

export interface ResearchProvider {
  readonly mode: ResearchMode;
  readonly model: string;
  readonly name: string;
  generate(input: ResearchProviderInput): Promise<ResearchProviderResult>;
}
