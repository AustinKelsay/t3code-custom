import { query, type SDKMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { Effect, Layer, Schema } from "effect";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { resolveClaudeApiModelId } from "@t3tools/shared/model";

import { TextGenerationError } from "../Errors.ts";
import {
  type BranchNameGenerationResult,
  type CommitMessageGenerationResult,
  type PrContentGenerationResult,
  type TextGenerationShape,
  TextGeneration,
} from "../Services/TextGeneration.ts";

const CLAUDE_EFFORT = "low" as const;
const CLAUDE_TIMEOUT_MS = 180_000;

function toClaudeOutputJsonSchema(schema: Schema.Top): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return {
      ...document.schema,
      $defs: document.definitions,
    };
  }
  return document.schema;
}

function normalizeClaudeError(
  operation: string,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (Schema.is(TextGenerationError)(error)) {
    return error;
  }

  if (error instanceof Error) {
    return new TextGenerationError({
      operation,
      detail: `${fallback}: ${error.message}`,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars);
  return `${truncated}\n\n[truncated]`;
}

function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }

  if (withoutTrailingPeriod.length <= 72) {
    return withoutTrailingPeriod;
  }
  return withoutTrailingPeriod.slice(0, 72).trimEnd();
}

function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  return singleLine.length > 0 ? singleLine : "Update project changes";
}

function resultErrorDetail(result: SDKResultMessage): string {
  if (result.subtype === "success") {
    return "";
  }

  const firstError = result.errors[0]?.trim();
  return firstError && firstError.length > 0
    ? firstError
    : "Claude did not complete the text generation request.";
}

function decodeClaudeStructuredOutput<S extends Schema.Top & { readonly DecodingServices: never }>(
  operation: string,
  schema: S,
  result: SDKResultMessage,
): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> {
  if (result.subtype !== "success") {
    return Effect.fail(
      new TextGenerationError({
        operation,
        detail: resultErrorDetail(result),
      }),
    );
  }

  return Effect.try({
    try: () => {
      const raw =
        result.structured_output ??
        (() => {
          const trimmed = result.result.trim();
          if (!trimmed) {
            throw new Error("Claude returned an empty response.");
          }
          return JSON.parse(trimmed) as unknown;
        })();

      return Schema.decodeUnknownSync(schema)(raw);
    },
    catch: (cause) =>
      new TextGenerationError({
        operation,
        detail: "Claude returned invalid structured output.",
        cause,
      }),
  });
}

async function collectClaudeResult(
  prompt: string,
  input: {
    readonly operation: "generateCommitMessage" | "generatePrContent" | "generateBranchName";
    readonly model?: string;
    readonly outputSchemaJson: Record<string, unknown>;
  },
): Promise<SDKResultMessage> {
  const runtime = query({
    prompt,
    options: {
      ...(input.model
        ? { model: resolveClaudeApiModelId(input.model, undefined) ?? input.model }
        : {}),
      effort: CLAUDE_EFFORT,
      maxTurns: 1,
      permissionMode: "plan",
      tools: [],
      outputFormat: {
        type: "json_schema",
        schema: input.outputSchemaJson,
      },
    },
  });

  try {
    for await (const message of runtime as AsyncIterable<SDKMessage>) {
      if (message.type === "result") {
        return message;
      }
    }
  } finally {
    runtime.close();
  }

  throw new Error("Claude returned no final result.");
}

function runClaudeJson<S extends Schema.Top & { readonly DecodingServices: never }>(input: {
  readonly operation: "generateCommitMessage" | "generatePrContent" | "generateBranchName";
  readonly prompt: string;
  readonly outputSchemaJson: S;
  readonly model?: string;
}): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> {
  return Effect.tryPromise({
    try: () =>
      collectClaudeResult(input.prompt, {
        operation: input.operation,
        ...(input.model ? { model: input.model } : {}),
        outputSchemaJson: toClaudeOutputJsonSchema(input.outputSchemaJson),
      }),
    catch: (cause) =>
      normalizeClaudeError(input.operation, cause, "Failed to run Claude text generation"),
  }).pipe(
    Effect.timeoutOption(CLAUDE_TIMEOUT_MS),
    Effect.flatMap((resultOption) =>
      resultOption._tag === "None"
        ? Effect.fail(
            new TextGenerationError({
              operation: input.operation,
              detail: "Claude text generation request timed out.",
            }),
          )
        : decodeClaudeStructuredOutput(input.operation, input.outputSchemaJson, resultOption.value),
    ),
  );
}

export const makeClaudeTextGeneration = Effect.succeed({
  generateCommitMessage: (input) => {
    const wantsBranch = input.includeBranch === true;
    const prompt = [
      "You write concise git commit messages.",
      wantsBranch
        ? "Return a JSON object with keys: subject, body, branch."
        : "Return a JSON object with keys: subject, body.",
      "Rules:",
      "- subject must be imperative, <= 72 chars, and no trailing period",
      "- body can be empty string or short bullet points",
      ...(wantsBranch
        ? ["- branch must be a short semantic git branch fragment for this change"]
        : []),
      "- capture the primary user-visible or developer-visible change",
      "",
      `Branch: ${input.branch ?? "(detached)"}`,
      "",
      "Staged files:",
      limitSection(input.stagedSummary, 6_000),
      "",
      "Staged patch:",
      limitSection(input.stagedPatch, 40_000),
    ].join("\n");

    const outputSchemaJson = wantsBranch
      ? Schema.Struct({
          subject: Schema.String,
          body: Schema.String,
          branch: Schema.String,
        })
      : Schema.Struct({
          subject: Schema.String,
          body: Schema.String,
        });

    return runClaudeJson({
      operation: "generateCommitMessage",
      prompt,
      outputSchemaJson,
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            subject: sanitizeCommitSubject(generated.subject),
            body: generated.body.trim(),
            ...("branch" in generated && typeof generated.branch === "string"
              ? { branch: sanitizeFeatureBranchName(generated.branch) }
              : {}),
          }) satisfies CommitMessageGenerationResult,
      ),
    );
  },
  generatePrContent: (input) => {
    const prompt = [
      "You write GitHub pull request content.",
      "Return a JSON object with keys: title, body.",
      "Rules:",
      "- title should be concise and specific",
      "- body must be markdown and include headings '## Summary' and '## Testing'",
      "- under Summary, provide short bullet points",
      "- under Testing, include bullet points with concrete checks or 'Not run' where appropriate",
      "",
      `Base branch: ${input.baseBranch}`,
      `Head branch: ${input.headBranch}`,
      "",
      "Commits:",
      limitSection(input.commitSummary, 12_000),
      "",
      "Diff stat:",
      limitSection(input.diffSummary, 12_000),
      "",
      "Diff patch:",
      limitSection(input.diffPatch, 40_000),
    ].join("\n");

    return runClaudeJson({
      operation: "generatePrContent",
      prompt,
      outputSchemaJson: Schema.Struct({
        title: Schema.String,
        body: Schema.String,
      }),
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            title: sanitizePrTitle(generated.title),
            body: generated.body.trim(),
          }) satisfies PrContentGenerationResult,
      ),
    );
  },
  generateBranchName: (input) => {
    const attachmentLines = (input.attachments ?? []).map(
      (attachment) =>
        `- ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes)`,
    );
    const promptSections = [
      "You generate concise git branch names.",
      "Return a JSON object with key: branch.",
      "Rules:",
      "- Branch should describe the requested work from the user message.",
      "- Keep it short and specific (2-6 words).",
      "- Use plain words only, no issue prefixes and no punctuation-heavy text.",
      "- If attachments are present, use their metadata as additional context.",
      "",
      "User message:",
      limitSection(input.message, 8_000),
    ];
    if (attachmentLines.length > 0) {
      promptSections.push(
        "",
        "Attachment metadata:",
        limitSection(attachmentLines.join("\n"), 4_000),
      );
    }

    return runClaudeJson({
      operation: "generateBranchName",
      prompt: promptSections.join("\n"),
      outputSchemaJson: Schema.Struct({
        branch: Schema.String,
      }),
      ...(input.model ? { model: input.model } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            branch: sanitizeBranchFragment(generated.branch),
          }) satisfies BranchNameGenerationResult,
      ),
    );
  },
} satisfies TextGenerationShape);

export const ClaudeTextGenerationLive = Layer.effect(TextGeneration, makeClaudeTextGeneration);
