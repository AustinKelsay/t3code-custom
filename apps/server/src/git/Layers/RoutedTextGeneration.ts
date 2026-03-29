import { Effect, Layer } from "effect";
import { inferProviderForModel } from "@t3tools/shared/model";

import { type TextGenerationShape, TextGeneration } from "../Services/TextGeneration.ts";
import { makeClaudeTextGeneration } from "./ClaudeTextGeneration.ts";
import { makeCodexTextGeneration } from "./CodexTextGeneration.ts";

const makeRoutedTextGeneration = Effect.gen(function* () {
  const codex = yield* makeCodexTextGeneration;
  const claude = yield* makeClaudeTextGeneration;

  const resolveTextGeneration = (model: string | undefined) =>
    inferProviderForModel(model, "codex") === "claudeAgent" ? claude : codex;

  return {
    generateCommitMessage: (input) =>
      resolveTextGeneration(input.model).generateCommitMessage(input),
    generatePrContent: (input) => resolveTextGeneration(input.model).generatePrContent(input),
    generateBranchName: (input) => resolveTextGeneration(input.model).generateBranchName(input),
  } satisfies TextGenerationShape;
});

export const RoutedTextGenerationLive = Layer.effect(TextGeneration, makeRoutedTextGeneration);
