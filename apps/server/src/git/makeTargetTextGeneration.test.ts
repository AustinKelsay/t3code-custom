import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { makeTargetTextGeneration } from "./makeTargetTextGeneration.ts";
import type { TextGenerationShape } from "./Services/TextGeneration.ts";

describe("makeTargetTextGeneration", () => {
  it("preserves cwd for local targets", async () => {
    const seenCwds: string[] = [];
    const baseTextGeneration: TextGenerationShape = {
      generateCommitMessage: (input) =>
        Effect.sync(() => {
          seenCwds.push(input.cwd);
          return { subject: "Commit", body: "" };
        }),
      generatePrContent: (input) =>
        Effect.sync(() => {
          seenCwds.push(input.cwd);
          return { title: "PR", body: "" };
        }),
      generateBranchName: (input) =>
        Effect.sync(() => {
          seenCwds.push(input.cwd);
          return { branch: "branch" };
        }),
    };

    const wrapped = makeTargetTextGeneration({
      target: {
        id: "local",
        kind: "local",
        label: "Local",
        connection: { kind: "local" },
        capabilities: {
          provider: true,
          terminal: true,
          git: true,
          files: true,
          search: true,
          attachments: true,
          portForward: true,
        },
        health: { status: "healthy" },
      },
      textGeneration: baseTextGeneration,
      fallbackCwd: "/safe/local-cwd",
    });

    await Effect.runPromise(
      wrapped.generateCommitMessage({
        cwd: "/repo/path",
        branch: "main",
        stagedSummary: "M file.ts",
        stagedPatch: "diff --git",
      }),
    );

    expect(seenCwds).toEqual(["/repo/path"]);
  });

  it("replaces cwd for ssh targets", async () => {
    const seenCwds: string[] = [];
    const baseTextGeneration: TextGenerationShape = {
      generateCommitMessage: (input) =>
        Effect.sync(() => {
          seenCwds.push(input.cwd);
          return { subject: "Commit", body: "" };
        }),
      generatePrContent: (input) =>
        Effect.sync(() => {
          seenCwds.push(input.cwd);
          return { title: "PR", body: "" };
        }),
      generateBranchName: (input) =>
        Effect.sync(() => {
          seenCwds.push(input.cwd);
          return { branch: "branch" };
        }),
    };

    const wrapped = makeTargetTextGeneration({
      target: {
        id: "ssh-target",
        kind: "ssh",
        label: "Remote",
        connection: { kind: "ssh", host: "example.com" },
        capabilities: {
          provider: true,
          terminal: true,
          git: true,
          files: true,
          search: true,
          attachments: true,
          portForward: true,
        },
        health: { status: "healthy" },
      },
      textGeneration: baseTextGeneration,
      fallbackCwd: "/safe/local-cwd",
    });

    await Effect.runPromise(
      wrapped.generateCommitMessage({
        cwd: "/Users/nick/code/zaprite-zapier",
        branch: "main",
        stagedSummary: "M file.ts",
        stagedPatch: "diff --git",
      }),
    );

    expect(seenCwds).toEqual([process.cwd()]);
  });
});
