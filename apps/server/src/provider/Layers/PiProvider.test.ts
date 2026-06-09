// @effect-diagnostics preferSchemaOverJson:off - Tests encode and decode JSONL provider fixtures.
import { assert, it } from "@effect/vitest";
import { PiSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { checkPiProviderStatus } from "./PiProvider.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function jsonl(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value)}\n`);
}

function failingSpawnerLayer(description: string) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() =>
      Effect.fail(
        PlatformError.systemError({
          _tag: "NotFound",
          module: "ChildProcess",
          method: "spawn",
          description,
        }),
      ),
    ),
  );
}

const makePiSettings = (overrides?: Partial<PiSettings>): PiSettings =>
  decodePiSettings({
    enabled: true,
    binaryPath: "pi",
    ...overrides,
  });

it.effect("populates Pi provider models from the runtime get_available_models RPC response", () =>
  Effect.gen(function* () {
    const rpcCommands: Array<unknown> = [];
    const spawner = ChildProcessSpawner.make((command) => {
      const childProcess = command as unknown as {
        readonly args: ReadonlyArray<string>;
      };
      if (childProcess.args.includes("--version")) {
        return Effect.succeed(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(1),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            unref: Effect.succeed(Effect.void),
            stdin: Sink.drain,
            stdout: Stream.make(encoder.encode("0.79.0\n")),
            stderr: Stream.empty,
            all: Stream.empty,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
          }),
        );
      }

      return Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(2),
          exitCode: Effect.never,
          isRunning: Effect.succeed(true),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.forEach((chunk: Uint8Array) =>
            Effect.sync(() => {
              for (const line of decoder.decode(chunk).trim().split(/\r?\n/)) {
                if (line.length > 0) {
                  const parsed = JSON.parse(line) as unknown;
                  rpcCommands.push(parsed);
                }
              }
            }),
          ),
          stdout: Stream.make(
            jsonl({
              id: "pi-provider-get_available_models",
              type: "response",
              command: "get_available_models",
              success: true,
              data: {
                models: [
                  {
                    id: "alpha",
                    name: "Alpha Model",
                    provider: "spark-ingress",
                    reasoning: false,
                    contextWindow: 64000,
                  },
                  {
                    id: "beta-thinking",
                    name: "Beta Thinking",
                    provider: "omlx",
                    reasoning: true,
                    contextWindow: 131072,
                  },
                ],
              },
            }),
          ),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        }),
      );
    });

    const snapshot = yield* checkPiProviderStatus(makePiSettings()).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    assert.deepStrictEqual(
      rpcCommands.map((command) =>
        typeof command === "object" && command !== null
          ? { ...(command as Record<string, unknown>), id: "<command-id>" }
          : command,
      ),
      [{ id: "<command-id>", type: "get_available_models" }],
    );
    assert.strictEqual(snapshot.status, "ready");
    assert.strictEqual(snapshot.installed, true);
    assert.strictEqual(snapshot.version, "0.79.0");
    assert.deepStrictEqual(snapshot.models, [
      {
        slug: "spark-ingress/alpha",
        name: "Alpha Model",
        subProvider: "spark-ingress",
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "thinkingLevel",
              label: "Thinking",
              type: "select",
              currentValue: "medium",
              options: [
                { id: "off", label: "Off" },
                { id: "minimal", label: "Minimal" },
                { id: "low", label: "Low" },
                { id: "medium", label: "Medium", isDefault: true },
                { id: "high", label: "High" },
                { id: "xhigh", label: "Extra High" },
              ],
            },
          ],
        },
        maxContextTokens: 64000,
      },
      {
        slug: "omlx/beta-thinking",
        name: "Beta Thinking",
        subProvider: "omlx",
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "thinkingLevel",
              label: "Thinking",
              type: "select",
              currentValue: "medium",
              options: [
                { id: "off", label: "Off" },
                { id: "minimal", label: "Minimal" },
                { id: "low", label: "Low" },
                { id: "medium", label: "Medium", isDefault: true },
                { id: "high", label: "High" },
                { id: "xhigh", label: "Extra High" },
              ],
            },
          ],
        },
        maxContextTokens: 131072,
      },
    ]);
  }),
);

it.effect("reports the Pi CLI as offline when the configured binary is missing", () =>
  Effect.gen(function* () {
    const snapshot = yield* checkPiProviderStatus(makePiSettings());

    assert.strictEqual(snapshot.status, "error");
    assert.strictEqual(snapshot.installed, false);
    assert.strictEqual(snapshot.auth.status, "unknown");
    assert.strictEqual(snapshot.version, null);
    assert.strictEqual(snapshot.message, "Pi CLI (`pi`) is not installed or not on PATH.");
  }).pipe(Effect.provide(failingSpawnerLayer("spawn pi ENOENT"))),
);
