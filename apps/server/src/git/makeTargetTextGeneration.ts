import type { ExecutionTarget } from "@t3tools/contracts";

import type { TextGenerationShape } from "./Services/TextGeneration.ts";

function resolveCodexTextGenerationCwd(target: ExecutionTarget, fallbackCwd: string): string {
  if (target.connection.kind === "local") {
    return fallbackCwd;
  }

  return process.cwd();
}

export function makeTargetTextGeneration(input: {
  readonly target: ExecutionTarget;
  readonly textGeneration: TextGenerationShape;
  readonly fallbackCwd: string;
}): TextGenerationShape {
  const resolveCwd = () => resolveCodexTextGenerationCwd(input.target, input.fallbackCwd);

  return {
    generateCommitMessage: (request) =>
      input.textGeneration.generateCommitMessage({
        ...request,
        cwd: resolveCwd(),
      }),
    generatePrContent: (request) =>
      input.textGeneration.generatePrContent({
        ...request,
        cwd: resolveCwd(),
      }),
    generateBranchName: (request) =>
      input.textGeneration.generateBranchName({
        ...request,
        cwd: resolveCwd(),
      }),
  };
}
