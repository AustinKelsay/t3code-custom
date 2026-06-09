// @effect-diagnostics preferSchemaOverJson:off - Pi CLI JSONL commands are provider boundary payloads.
import { ProviderDriverKind, type PiSettings, type ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildSelectOptionDescriptor,
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  ProviderCommandExecutionError,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PROVIDER = ProviderDriverKind.make("pi");
const encoder = new TextEncoder();
const PI_THINKING_LEVEL_CAPABILITIES = createModelCapabilities({
  optionDescriptors: [
    buildSelectOptionDescriptor({
      id: "thinkingLevel",
      label: "Thinking",
      options: [
        { value: "off", label: "Off" },
        { value: "minimal", label: "Minimal" },
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium", isDefault: true },
        { value: "high", label: "High" },
        { value: "xhigh", label: "Extra High" },
      ],
    }),
  ],
});

const PI_PRESENTATION = {
  displayName: "Pi",
  showInteractionModeToggle: true,
} as const;

const runPiCommand = Effect.fn("runPiCommand")(function* (
  piSettings: PiSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const command = ChildProcess.make(piSettings.binaryPath, [...args], {
    env: environment,
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(piSettings.binaryPath, command);
});

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function positiveIntField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function parsePiRpcResponseLine(
  commandName: string,
  line: string,
): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (
      isObject(parsed) &&
      parsed.type === "response" &&
      stringField(parsed, "command") === commandName
    ) {
      return parsed;
    }
  } catch {
    // Ignore non-JSON startup noise from provider processes.
  }
  return undefined;
}

function toPiRpcExecutionError(cause: unknown): ProviderCommandExecutionError {
  if (cause instanceof ProviderCommandExecutionError) {
    return cause;
  }
  return new ProviderCommandExecutionError({
    message:
      cause instanceof Error
        ? cause.message
        : `Pi RPC process failed: ${typeof cause === "string" ? cause : String(cause)}.`,
  });
}

const runPiRpcCommand = (
  piSettings: PiSettings,
  commandName: string,
  commandBody: Record<string, unknown>,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.Effect<unknown, ProviderCommandExecutionError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = ChildProcess.make(
      piSettings.binaryPath,
      ["--mode", "rpc", "--no-session", "--no-extensions", "--no-skills"],
      {
        env: environment,
        shell: process.platform === "win32",
      },
    );
    const child = yield* spawner.spawn(command).pipe(Effect.mapError(toPiRpcExecutionError));
    const request = {
      id: `pi-provider-${commandName}`,
      ...commandBody,
    };

    return yield* Effect.gen(function* () {
      const responseOption = yield* Effect.all(
        [
          child.stdout.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.map((line) => line.trim()),
            Stream.filter((line) => line.length > 0),
            Stream.filter((line) => parsePiRpcResponseLine(commandName, line) !== undefined),
            Stream.runHead,
          ),
          Stream.run(Stream.make(encoder.encode(`${JSON.stringify(request)}\n`)), child.stdin),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.map(([response]) => response));

      if (Option.isNone(responseOption)) {
        return yield* new ProviderCommandExecutionError({
          message: `Pi RPC did not return a response for ${commandName}.`,
        });
      }
      const response = parsePiRpcResponseLine(commandName, responseOption.value);
      if (!response) {
        return yield* new ProviderCommandExecutionError({
          message: `Pi RPC returned an invalid response for ${commandName}.`,
        });
      }
      if (response.success !== true) {
        const error = stringField(response, "error") ?? "Unknown Pi RPC error.";
        return yield* new ProviderCommandExecutionError({
          message: `Pi RPC ${commandName} failed: ${error}`,
        });
      }
      return response.data;
    }).pipe(
      Effect.mapError(toPiRpcExecutionError),
      Effect.ensuring(child.kill().pipe(Effect.ignore)),
    );
  }).pipe(Effect.scoped);

function buildPiModelsFromRpcData(data: unknown): ReadonlyArray<ServerProviderModel> {
  if (!isObject(data) || !Array.isArray(data.models)) {
    return [];
  }
  const seen = new Set<string>();
  const models: ServerProviderModel[] = [];
  for (const candidate of data.models) {
    if (!isObject(candidate)) continue;
    const provider = stringField(candidate, "provider");
    const id = stringField(candidate, "id");
    if (!provider || !id) continue;
    const slug = `${provider}/${id}`;
    if (seen.has(slug)) continue;
    seen.add(slug);
    const contextWindow = positiveIntField(candidate, "contextWindow");
    models.push({
      slug,
      name: stringField(candidate, "name") ?? slug,
      subProvider: provider,
      isCustom: false,
      capabilities: PI_THINKING_LEVEL_CAPABILITIES,
      ...(contextWindow ? { maxContextTokens: contextWindow } : {}),
    });
  }
  return models;
}

export const makePendingPiProvider = (piSettings: PiSettings): Effect.Effect<ServerProviderDraft> =>
  Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);

    if (!piSettings.enabled) {
      return buildServerProvider({
        presentation: PI_PRESENTATION,
        enabled: false,
        checkedAt,
        models: [],
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Pi is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: [],
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Pi provider status has not been checked in this session yet.",
      },
    });
  });

export const checkPiProviderStatus = Effect.fn("checkPiProviderStatus")(function* (
  piSettings: PiSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);

  if (!piSettings.enabled) {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: false,
      checkedAt,
      models: [],
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Pi is disabled in T3 Code settings.",
      },
    });
  }

  const versionProbe = yield* runPiCommand(piSettings, ["--version"], environment).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: piSettings.enabled,
      checkedAt,
      models: [],
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Pi CLI (`pi`) is not installed or not on PATH."
          : `Failed to execute Pi CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: piSettings.enabled,
      checkedAt,
      models: [],
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Pi CLI is installed but timed out while running `pi --version`.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      presentation: PI_PRESENTATION,
      enabled: piSettings.enabled,
      checkedAt,
      models: [],
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Pi CLI is installed but failed to run. ${detail}`
          : "Pi CLI is installed but failed to run.",
      },
    });
  }

  const modelsProbe = yield* runPiRpcCommand(
    piSettings,
    "get_available_models",
    { type: "get_available_models" },
    environment,
  ).pipe(Effect.timeoutOption(DEFAULT_TIMEOUT_MS), Effect.result);
  let models: ReadonlyArray<ServerProviderModel> = [];
  let modelDiscoveryWarning: string | undefined;
  if (Result.isSuccess(modelsProbe)) {
    if (Option.isSome(modelsProbe.success)) {
      models = buildPiModelsFromRpcData(modelsProbe.success.value);
    } else {
      modelDiscoveryWarning = "Pi model discovery timed out.";
    }
  } else {
    const error = modelsProbe.failure;
    modelDiscoveryWarning = `Pi model discovery failed: ${
      error instanceof Error ? error.message : String(error)
    }.`;
  }

  return buildServerProvider({
    presentation: PI_PRESENTATION,
    enabled: piSettings.enabled,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: parsedVersion,
      status: modelDiscoveryWarning ? "warning" : "ready",
      auth: { status: "unknown" },
      ...(modelDiscoveryWarning ? { message: modelDiscoveryWarning } : {}),
    },
  });
});

export { PROVIDER as PI_PROVIDER_DRIVER_KIND };
