import type { ExecutionTarget } from "@t3tools/contracts";
import { Effect } from "effect";

import { runTargetProcess } from "../executionTarget/targetProcess.ts";
import { GitCommandError } from "./Errors.ts";
import type { GitServiceShape } from "./Services/GitService.ts";

export function makeTargetGitService(target: ExecutionTarget): GitServiceShape {
  return {
    execute: (input) =>
      Effect.tryPromise({
        try: async () => {
          const normalizedEnv =
            input.env === undefined
              ? undefined
              : Object.fromEntries(
                  Object.entries(input.env).filter(
                    (entry): entry is [string, string] => typeof entry[1] === "string",
                  ),
                );

          const result = await runTargetProcess({
            target,
            command: "git",
            args: input.args,
            cwd: input.cwd,
            ...(normalizedEnv ? { env: normalizedEnv } : {}),
            ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
            allowNonZeroExit: true,
            ...(input.maxOutputBytes !== undefined ? { maxBufferBytes: input.maxOutputBytes } : {}),
          });

          return {
            code: result.code ?? 1,
            stdout: result.stdout,
            stderr: result.stderr,
          };
        },
        catch: (cause) =>
          new GitCommandError({
            operation: input.operation,
            command: `git ${input.args.join(" ")}`,
            cwd: input.cwd,
            detail: cause instanceof Error ? cause.message : "Git command execution failed.",
            cause,
          }),
      }),
  };
}
