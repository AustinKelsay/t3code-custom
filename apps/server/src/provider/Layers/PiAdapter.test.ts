import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  PiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PlatformError from "effect/PlatformError";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { makePiAdapter } from "./PiAdapter.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PI_PROVIDER = ProviderDriverKind.make("pi");
const PI_INSTANCE = ProviderInstanceId.make("pi_default");

type ChildProcessCommand = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
};

function jsonl(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value)}\n`);
}

function makePiSettings(overrides?: Partial<PiSettings>): PiSettings {
  return decodePiSettings({
    enabled: true,
    binaryPath: "fake-pi",
    ...overrides,
  });
}

function scrubCommandId(line: unknown): unknown {
  return typeof line === "object" && line !== null
    ? { ...(line as Record<string, unknown>), id: "<command-id>" }
    : line;
}

function findCommand(lines: ReadonlyArray<unknown>, type: string): Record<string, unknown> {
  const command = lines.find(
    (line): line is Record<string, unknown> =>
      typeof line === "object" && line !== null && (line as Record<string, unknown>).type === type,
  );
  assert.ok(command, `Expected ${type} command`);
  return command;
}

function makePiAdapterHarness(options?: { readonly stdinWriteError?: string }) {
  return Effect.gen(function* () {
    const exitCode = yield* Deferred.make<ChildProcessSpawner.ExitCode>();
    const stdout = yield* Queue.unbounded<Uint8Array>();
    const stdinLines: Array<unknown> = [];
    const commands: Array<ChildProcessCommand> = [];
    const killCalls: Array<void> = [];
    const spawner = ChildProcessSpawner.make((command) =>
      Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Deferred.await(exitCode),
          isRunning: Effect.succeed(true),
          kill: () =>
            Effect.gen(function* () {
              killCalls.push(undefined);
              yield* Queue.shutdown(stdout);
              yield* Deferred.succeed(exitCode, ChildProcessSpawner.ExitCode(0)).pipe(
                Effect.ignore,
              );
            }),
          unref: Effect.succeed(Effect.void),
          stdin: Sink.forEach((chunk: Uint8Array) =>
            Effect.gen(function* () {
              if (options?.stdinWriteError) {
                return yield* Effect.fail(
                  PlatformError.systemError({
                    _tag: "Unknown",
                    module: "ChildProcess",
                    method: "stdin",
                    description: options.stdinWriteError,
                  }),
                );
              }
              yield* Effect.sync(() => {
                for (const line of decoder.decode(chunk).trim().split(/\r?\n/)) {
                  if (line.length > 0) {
                    stdinLines.push(JSON.parse(line));
                  }
                }
              });
            }),
          ),
          stdout: Stream.fromQueue(stdout),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        }),
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (ChildProcess.isStandardCommand(command)) {
              commands.push({
                command: command.command,
                args: command.args,
              });
            }
          }),
        ),
      ),
    );

    const adapter = yield* makePiAdapter(makePiSettings(), {
      instanceId: PI_INSTANCE,
    }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

    return {
      adapter,
      commands,
      exitCode,
      killCalls,
      stdinLines,
      stdout,
    };
  });
}

it.layer(NodeServices.layer)("makePiAdapter", (it) => {
  it.effect("sends a prompt to pi rpc and emits canonical streaming turn events", () =>
    Effect.gen(function* () {
      const { adapter, commands, stdinLines, stdout } = yield* makePiAdapterHarness();
      const eventsFiber = yield* Stream.take(adapter.streamEvents, 5).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );
      const threadId = ThreadId.make("thread-pi-basic-turn");

      const session = yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      const turn = yield* adapter.sendTurn({
        threadId,
        input: "hello pi",
      });

      yield* Queue.offer(
        stdout,
        jsonl({
          type: "message_update",
          delta: { type: "text_delta", text: "hello from pi" },
        }),
      );
      yield* Queue.offer(stdout, jsonl({ type: "turn_end", stop_reason: "complete" }));

      const events = Array.from(yield* Fiber.join(eventsFiber));
      const eventTypes = events.map((event) => event.type);

      assert.deepStrictEqual(commands, [
        {
          command: "fake-pi",
          args: ["--mode", "rpc", "--session-id", "thread-pi-basic-turn"],
        },
      ]);
      assert.strictEqual(stdinLines.length, 1);
      assert.deepStrictEqual(
        typeof stdinLines[0] === "object" && stdinLines[0] !== null
          ? { ...(stdinLines[0] as Record<string, unknown>), id: "<turn-id>" }
          : stdinLines[0],
        { id: "<turn-id>", type: "prompt", message: "hello pi" },
      );
      assert.strictEqual(session.status, "ready");
      assert.strictEqual(turn.threadId, threadId);
      assert.deepStrictEqual(eventTypes, [
        "session.started",
        "thread.started",
        "turn.started",
        "content.delta",
        "turn.completed",
      ]);
      assert.deepStrictEqual(events[3]?.payload, {
        streamKind: "assistant_text",
        delta: "hello from pi",
      });
      assert.deepStrictEqual(events[4]?.payload, {
        state: "completed",
        stopReason: "complete",
      });
    }).pipe(Effect.scoped),
  );

  it.effect("rejects a second prompt while a Pi turn is still active", () =>
    Effect.gen(function* () {
      const { adapter, stdinLines } = yield* makePiAdapterHarness();
      const threadId = ThreadId.make("thread-pi-overlapping-turn");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "first prompt",
      });

      const error = yield* adapter
        .sendTurn({
          threadId,
          input: "second prompt",
        })
        .pipe(Effect.flip);

      assert.strictEqual(error._tag, "ProviderAdapterRequestError");
      if (error._tag !== "ProviderAdapterRequestError") {
        throw new Error("Unexpected error type");
      }
      assert.strictEqual(error.method, "sendTurn");
      assert.strictEqual(error.detail, "Pi session already has an active turn.");
      assert.strictEqual(stdinLines.length, 1);
      assert.deepStrictEqual(
        typeof stdinLines[0] === "object" && stdinLines[0] !== null
          ? { ...(stdinLines[0] as Record<string, unknown>), id: "<turn-id>" }
          : stdinLines[0],
        { id: "<turn-id>", type: "prompt", message: "first prompt" },
      );
    }).pipe(Effect.scoped),
  );

  it.effect("switches Pi models before sending a turn with a different selected model", () =>
    Effect.gen(function* () {
      const { adapter, stdinLines, stdout } = yield* makePiAdapterHarness();
      const threadId = ThreadId.make("thread-pi-model-switch");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });

      const turnFiber = yield* adapter
        .sendTurn({
          threadId,
          input: "use alpha",
          modelSelection: createModelSelection(PI_INSTANCE, "spark-ingress/alpha"),
        })
        .pipe(Effect.forkChild);
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));

      const setModelCommand = findCommand(stdinLines, "set_model");
      assert.deepStrictEqual(scrubCommandId(setModelCommand), {
        id: "<command-id>",
        type: "set_model",
        provider: "spark-ingress",
        modelId: "alpha",
      });
      assert.strictEqual(
        stdinLines.some(
          (line) =>
            typeof line === "object" &&
            line !== null &&
            (line as Record<string, unknown>).type === "prompt",
        ),
        false,
      );

      yield* Queue.offer(
        stdout,
        jsonl({
          id: setModelCommand.id,
          type: "response",
          command: "set_model",
          success: true,
          data: {
            provider: "spark-ingress",
            id: "alpha",
          },
        }),
      );

      const turn = yield* Fiber.join(turnFiber);
      const promptCommand = findCommand(stdinLines, "prompt");
      assert.strictEqual(turn.threadId, threadId);
      assert.deepStrictEqual(scrubCommandId(promptCommand), {
        id: "<command-id>",
        type: "prompt",
        message: "use alpha",
      });
      const sessions = yield* adapter.listSessions();
      assert.strictEqual(sessions[0]?.model, "spark-ingress/alpha");
    }).pipe(Effect.scoped),
  );

  it.effect("steers an active Pi turn after Pi accepts the native steer command", () =>
    Effect.gen(function* () {
      const { adapter, stdinLines, stdout } = yield* makePiAdapterHarness();
      const threadId = ThreadId.make("thread-pi-native-steer");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      const turn = yield* adapter.sendTurn({
        threadId,
        input: "first prompt",
      });

      const steerFiber = yield* adapter
        .steerTurn({
          threadId,
          expectedTurnId: turn.turnId,
          input: "use the smaller refactor",
        })
        .pipe(Effect.forkChild);
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));

      assert.deepStrictEqual(stdinLines.slice(1, 3).map(scrubCommandId), [
        { id: "<command-id>", type: "set_steering_mode", mode: "one-at-a-time" },
        { id: "<command-id>", type: "set_follow_up_mode", mode: "one-at-a-time" },
      ]);
      const steerCommand = findCommand(stdinLines, "steer");
      assert.deepStrictEqual(scrubCommandId(steerCommand), {
        id: "<command-id>",
        type: "steer",
        message: "use the smaller refactor",
      });
      yield* Queue.offer(
        stdout,
        jsonl({
          id: steerCommand.id,
          type: "response",
          command: "steer",
          success: true,
        }),
      );

      assert.deepStrictEqual(yield* Fiber.join(steerFiber), {
        threadId,
        turnId: turn.turnId,
      });
    }).pipe(Effect.scoped),
  );

  it.effect("fails native steer when Pi rejects the command response", () =>
    Effect.gen(function* () {
      const { adapter, stdinLines, stdout } = yield* makePiAdapterHarness();
      const threadId = ThreadId.make("thread-pi-native-steer-rejected");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      const turn = yield* adapter.sendTurn({
        threadId,
        input: "first prompt",
      });

      const steerFiber = yield* adapter
        .steerTurn({
          threadId,
          expectedTurnId: turn.turnId,
          input: "use the smaller refactor",
        })
        .pipe(Effect.flip, Effect.forkChild);
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      const steerCommand = findCommand(stdinLines, "steer");
      yield* Queue.offer(
        stdout,
        jsonl({
          id: steerCommand.id,
          type: "response",
          command: "steer",
          success: false,
          error: "Agent is not streaming.",
        }),
      );

      const error = yield* Fiber.join(steerFiber);
      assert.strictEqual(error._tag, "ProviderAdapterRequestError");
      if (error._tag !== "ProviderAdapterRequestError") {
        throw new Error("Unexpected error type");
      }
      assert.strictEqual(error.method, "pi/steer");
      assert.strictEqual(error.detail, "Agent is not streaming.");
    }).pipe(Effect.scoped),
  );

  it.effect("rejects native steer when the active turn no longer matches", () =>
    Effect.gen(function* () {
      const { adapter, stdinLines, stdout } = yield* makePiAdapterHarness();
      const threadId = ThreadId.make("thread-pi-native-steer-stale");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      const turn = yield* adapter.sendTurn({
        threadId,
        input: "first prompt",
      });
      yield* Queue.offer(stdout, jsonl({ type: "turn_end", stop_reason: "complete" }));
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));

      const error = yield* adapter
        .steerTurn({
          threadId,
          expectedTurnId: turn.turnId,
          input: "too late",
        })
        .pipe(Effect.flip);

      assert.strictEqual(error._tag, "ProviderAdapterRequestError");
      if (error._tag !== "ProviderAdapterRequestError") {
        throw new Error("Unexpected error type");
      }
      assert.strictEqual(error.method, "steerTurn");
      assert.strictEqual(error.detail, "Pi session does not have an active turn to steer.");
      assert.strictEqual(stdinLines.length, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("maps Pi queue_update events to visible queue snapshot updates", () =>
    Effect.gen(function* () {
      const { adapter, stdout } = yield* makePiAdapterHarness();
      const queueEvents: ProviderRuntimeEvent[] = [];
      const queueFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (event.type === "item.updated" && event.itemId === "pi-queue") {
            queueEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-queue-update");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      const turn = yield* adapter.sendTurn({
        threadId,
        input: "first prompt",
      });

      yield* Queue.offer(
        stdout,
        jsonl({
          type: "queue_update",
          steering: ["Focus on error handling"],
          followUp: ["After that, summarize the result"],
        }),
      );
      yield* Queue.offer(
        stdout,
        jsonl({
          type: "queue_update",
          steering: [],
          followUp: [],
        }),
      );
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      yield* Fiber.interrupt(queueFiber).pipe(Effect.ignore);

      assert.strictEqual(queueEvents.length, 2);
      assert.strictEqual(queueEvents[0]?.turnId, turn.turnId);
      assert.deepStrictEqual(queueEvents[0]?.payload, {
        itemType: "dynamic_tool_call",
        status: "inProgress",
        title: "Pi queue",
        detail: "Steering: Focus on error handling\nFollow-up: After that, summarize the result",
        data: {
          id: "pi-queue",
          steering: ["Focus on error handling"],
          followUp: ["After that, summarize the result"],
        },
      });
      assert.deepStrictEqual(queueEvents[1]?.payload, {
        itemType: "dynamic_tool_call",
        status: "completed",
        title: "Pi queue",
        detail: "Pi queue is empty.",
        data: {
          id: "pi-queue",
          steering: [],
          followUp: [],
        },
      });
    }).pipe(Effect.scoped),
  );

  it.effect("bridges Pi confirm extension UI requests through approval responses", () =>
    Effect.gen(function* () {
      const { adapter, stdinLines, stdout } = yield* makePiAdapterHarness();
      const approvalEvents: ProviderRuntimeEvent[] = [];
      const approvalFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (event.type === "request.opened" || event.type === "request.resolved") {
            approvalEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-confirm-bridge");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      const turn = yield* adapter.sendTurn({
        threadId,
        input: "first prompt",
      });

      yield* Queue.offer(
        stdout,
        jsonl({
          type: "extension_ui_request",
          id: "pi-confirm-1",
          method: "confirm",
          title: "Allow command?",
          message: "Run rm -rf build?",
        }),
      );
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));

      assert.strictEqual(approvalEvents.length, 1);
      assert.strictEqual(approvalEvents[0]?.type, "request.opened");
      assert.strictEqual(approvalEvents[0]?.requestId, "pi-confirm-1");
      assert.strictEqual(approvalEvents[0]?.turnId, turn.turnId);
      assert.deepStrictEqual(approvalEvents[0]?.payload, {
        requestType: "command_execution_approval",
        detail: "Allow command?\nRun rm -rf build?",
        args: {
          id: "pi-confirm-1",
          method: "confirm",
          title: "Allow command?",
          message: "Run rm -rf build?",
        },
      });

      yield* adapter.respondToRequest(threadId, ApprovalRequestId.make("pi-confirm-1"), "accept");
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      yield* Fiber.interrupt(approvalFiber).pipe(Effect.ignore);

      assert.deepStrictEqual(stdinLines.at(-1), {
        type: "extension_ui_response",
        id: "pi-confirm-1",
        confirmed: true,
      });
      assert.strictEqual(approvalEvents[1]?.type, "request.resolved");
      assert.deepStrictEqual(approvalEvents[1]?.payload, {
        requestType: "command_execution_approval",
        decision: "accept",
      });
    }).pipe(Effect.scoped),
  );

  it.effect("maps cancelled Pi confirm approvals to cancelled extension UI responses", () =>
    Effect.gen(function* () {
      const { adapter, stdinLines, stdout } = yield* makePiAdapterHarness();
      const threadId = ThreadId.make("thread-pi-confirm-cancelled");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "first prompt",
      });
      yield* Queue.offer(
        stdout,
        jsonl({
          type: "extension_ui_request",
          id: "pi-confirm-cancel",
          method: "confirm",
          title: "Confirm",
          message: "Proceed?",
        }),
      );
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));

      yield* adapter.respondToRequest(
        threadId,
        ApprovalRequestId.make("pi-confirm-cancel"),
        "cancel",
      );

      assert.deepStrictEqual(stdinLines.at(-1), {
        type: "extension_ui_response",
        id: "pi-confirm-cancel",
        cancelled: true,
      });
    }).pipe(Effect.scoped),
  );

  it.effect("bridges Pi select extension UI requests through user-input responses", () =>
    Effect.gen(function* () {
      const { adapter, stdinLines, stdout } = yield* makePiAdapterHarness();
      const userInputEvents: ProviderRuntimeEvent[] = [];
      const userInputFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (event.type === "user-input.requested" || event.type === "user-input.resolved") {
            userInputEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-select-bridge");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "first prompt",
      });

      yield* Queue.offer(
        stdout,
        jsonl({
          type: "extension_ui_request",
          id: "pi-select-1",
          method: "select",
          title: "Choose a backend",
          options: ["SQLite", "Postgres"],
        }),
      );
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));

      assert.strictEqual(userInputEvents[0]?.type, "user-input.requested");
      assert.strictEqual(userInputEvents[0]?.requestId, "pi-select-1");
      assert.deepStrictEqual(userInputEvents[0]?.payload, {
        questions: [
          {
            id: "value",
            header: "Choose a backend",
            question: "Choose a backend",
            options: [
              { label: "SQLite", description: "SQLite" },
              { label: "Postgres", description: "Postgres" },
            ],
            multiSelect: false,
          },
        ],
      });

      yield* adapter.respondToUserInput(threadId, ApprovalRequestId.make("pi-select-1"), {
        value: "Postgres",
      });
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      yield* Fiber.interrupt(userInputFiber).pipe(Effect.ignore);

      assert.deepStrictEqual(stdinLines.at(-1), {
        type: "extension_ui_response",
        id: "pi-select-1",
        value: "Postgres",
      });
      assert.deepStrictEqual(userInputEvents[1]?.payload, {
        answers: {
          value: "Postgres",
        },
      });
    }).pipe(Effect.scoped),
  );

  it.effect("bridges Pi input extension UI requests through user-input responses", () =>
    Effect.gen(function* () {
      const { adapter, stdinLines, stdout } = yield* makePiAdapterHarness();
      const userInputEvents: ProviderRuntimeEvent[] = [];
      const userInputFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (event.type === "user-input.requested" || event.type === "user-input.resolved") {
            userInputEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-input-bridge");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "first prompt",
      });

      yield* Queue.offer(
        stdout,
        jsonl({
          type: "extension_ui_request",
          id: "pi-input-1",
          method: "input",
          title: "API key",
          placeholder: "Paste token",
        }),
      );
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));

      assert.strictEqual(userInputEvents[0]?.type, "user-input.requested");
      assert.deepStrictEqual(userInputEvents[0]?.payload, {
        questions: [
          {
            id: "value",
            header: "API key",
            question: "Paste token",
            options: [],
            multiSelect: false,
          },
        ],
      });

      yield* adapter.respondToUserInput(threadId, ApprovalRequestId.make("pi-input-1"), {
        value: "secret-token",
      });
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      yield* Fiber.interrupt(userInputFiber).pipe(Effect.ignore);

      assert.deepStrictEqual(stdinLines.at(-1), {
        type: "extension_ui_response",
        id: "pi-input-1",
        value: "secret-token",
      });
      assert.deepStrictEqual(userInputEvents[1]?.payload, {
        answers: {
          value: "secret-token",
        },
      });
    }).pipe(Effect.scoped),
  );

  it.effect("cleans up timed-out Pi extension UI requests without writing a response", () =>
    Effect.gen(function* () {
      const { adapter, stdinLines, stdout } = yield* makePiAdapterHarness();
      const approvalEvents: ProviderRuntimeEvent[] = [];
      const approvalFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (event.type === "request.opened" || event.type === "request.resolved") {
            approvalEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-timeout-cleanup");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "first prompt",
      });
      yield* Queue.offer(
        stdout,
        jsonl({
          type: "extension_ui_request",
          id: "pi-timeout-1",
          method: "confirm",
          title: "Confirm",
          message: "Proceed?",
          timeout: 10,
        }),
      );
      yield* TestClock.adjust(Duration.millis(10));
      yield* Effect.yieldNow;

      const error = yield* adapter
        .respondToRequest(threadId, ApprovalRequestId.make("pi-timeout-1"), "accept")
        .pipe(Effect.flip);
      yield* Fiber.interrupt(approvalFiber).pipe(Effect.ignore);

      assert.strictEqual(approvalEvents.length, 2);
      assert.strictEqual(approvalEvents[0]?.type, "request.opened");
      assert.strictEqual(approvalEvents[1]?.type, "request.resolved");
      assert.deepStrictEqual(approvalEvents[1]?.payload, {
        requestType: "command_execution_approval",
        decision: "cancel",
      });
      assert.strictEqual(stdinLines.length, 1);
      assert.strictEqual(error._tag, "ProviderAdapterRequestError");
      if (error._tag !== "ProviderAdapterRequestError") {
        throw new Error("Unexpected error type");
      }
      assert.strictEqual(error.detail, "Unknown pending Pi extension UI request: pi-timeout-1");
    }).pipe(Effect.scoped),
  );

  it.effect("handles multiple concurrent Pi extension UI requests independently", () =>
    Effect.gen(function* () {
      const { adapter, stdinLines, stdout } = yield* makePiAdapterHarness();
      const threadId = ThreadId.make("thread-pi-concurrent-ui");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "first prompt",
      });
      yield* Queue.offer(
        stdout,
        jsonl({
          type: "extension_ui_request",
          id: "pi-confirm-concurrent",
          method: "confirm",
          title: "Confirm",
          message: "Proceed?",
        }),
      );
      yield* Queue.offer(
        stdout,
        jsonl({
          type: "extension_ui_request",
          id: "pi-input-concurrent",
          method: "input",
          title: "Name",
          placeholder: "Name",
        }),
      );
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));

      yield* adapter.respondToUserInput(threadId, ApprovalRequestId.make("pi-input-concurrent"), {
        value: "Ada",
      });
      yield* adapter.respondToRequest(
        threadId,
        ApprovalRequestId.make("pi-confirm-concurrent"),
        "decline",
      );

      assert.deepStrictEqual(stdinLines.slice(-2), [
        {
          type: "extension_ui_response",
          id: "pi-input-concurrent",
          value: "Ada",
        },
        {
          type: "extension_ui_response",
          id: "pi-confirm-concurrent",
          confirmed: false,
        },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("interrupts an active Pi turn with the native abort command", () =>
    Effect.gen(function* () {
      const { adapter, stdinLines, stdout } = yield* makePiAdapterHarness();
      const abortedEvents: ProviderRuntimeEvent[] = [];
      const abortedFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (event.type === "turn.aborted") {
            abortedEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-native-interrupt");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      const turn = yield* adapter.sendTurn({
        threadId,
        input: "keep working",
      });

      const interruptFiber = yield* adapter.interruptTurn(threadId).pipe(Effect.forkChild);
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));

      const abortCommand = findCommand(stdinLines, "abort");
      assert.deepStrictEqual(scrubCommandId(abortCommand), { id: "<command-id>", type: "abort" });
      yield* Queue.offer(
        stdout,
        jsonl({
          id: abortCommand.id,
          type: "response",
          command: "abort",
          success: true,
        }),
      );
      yield* Fiber.join(interruptFiber);
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      const sessions = yield* adapter.listSessions();
      yield* Fiber.interrupt(abortedFiber).pipe(Effect.ignore);

      assert.strictEqual(sessions[0]?.status, "ready");
      assert.strictEqual(sessions[0]?.activeTurnId, undefined);
      assert.deepStrictEqual(
        abortedEvents.map((event) => event.type),
        ["turn.aborted"],
      );
      assert.strictEqual(abortedEvents[0]?.turnId, turn.turnId);
      assert.deepStrictEqual(abortedEvents[0]?.payload, {
        reason: "Pi turn interrupted.",
      });
    }).pipe(Effect.scoped),
  );

  it.effect("sends a second prompt on the same Pi session after the first turn completes", () =>
    Effect.gen(function* () {
      const { adapter, commands, stdinLines, stdout } = yield* makePiAdapterHarness();
      const completedEvents: ProviderRuntimeEvent[] = [];
      const completedFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (event.type === "turn.completed") {
            completedEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-second-turn");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "first prompt",
      });
      yield* Queue.offer(stdout, jsonl({ type: "turn_end", stop_reason: "complete" }));
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));

      const secondTurn = yield* adapter.sendTurn({
        threadId,
        input: "second prompt",
      });
      yield* Queue.offer(stdout, jsonl({ type: "turn_end", stop_reason: "complete" }));
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      const sessions = yield* adapter.listSessions();
      yield* Fiber.interrupt(completedFiber).pipe(Effect.ignore);

      assert.strictEqual(commands.length, 1);
      assert.deepStrictEqual(
        stdinLines.map((line) =>
          typeof line === "object" && line !== null
            ? { ...(line as Record<string, unknown>), id: "<turn-id>" }
            : line,
        ),
        [
          { id: "<turn-id>", type: "prompt", message: "first prompt" },
          { id: "<turn-id>", type: "prompt", message: "second prompt" },
        ],
      );
      assert.strictEqual(secondTurn.threadId, threadId);
      assert.strictEqual(sessions[0]?.status, "ready");
      assert.strictEqual(sessions[0]?.activeTurnId, undefined);
      assert.deepStrictEqual(
        completedEvents.map((event) => event.type),
        ["turn.completed", "turn.completed"],
      );
    }).pipe(Effect.scoped),
  );

  it.effect("rolls a Pi session back to ready when Pi rejects a prompt response", () =>
    Effect.gen(function* () {
      const { adapter, stdinLines, stdout } = yield* makePiAdapterHarness();
      const abortedEvents: ProviderRuntimeEvent[] = [];
      const abortedFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (event.type === "turn.aborted") {
            abortedEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-prompt-rejected");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "will be rejected",
      });
      const command = stdinLines[0];
      const commandId =
        typeof command === "object" && command !== null
          ? String((command as Record<string, unknown>).id)
          : "missing-command-id";

      yield* Queue.offer(
        stdout,
        jsonl({
          id: commandId,
          type: "response",
          command: "prompt",
          success: false,
          error: "Pi is already streaming.",
        }),
      );
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      const sessions = yield* adapter.listSessions();
      yield* Fiber.interrupt(abortedFiber).pipe(Effect.ignore);

      assert.strictEqual(typeof commandId, "string");
      assert.notStrictEqual(commandId, "undefined");
      assert.strictEqual(sessions[0]?.status, "ready");
      assert.strictEqual(sessions[0]?.activeTurnId, undefined);
      assert.strictEqual(sessions[0]?.lastError, "Pi is already streaming.");
      assert.deepStrictEqual(
        abortedEvents.map((event) => event.type),
        ["turn.aborted"],
      );
      assert.deepStrictEqual(abortedEvents[0]?.payload, {
        reason: "Pi is already streaming.",
      });
    }).pipe(Effect.scoped),
  );

  it.effect("rolls a Pi session back to ready when writing a prompt fails", () =>
    Effect.gen(function* () {
      const { adapter, stdinLines } = yield* makePiAdapterHarness({
        stdinWriteError: "stdin closed",
      });
      const abortedEvents: ProviderRuntimeEvent[] = [];
      const abortedFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (event.type === "turn.aborted") {
            abortedEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-stdin-failure");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });

      const error = yield* adapter
        .sendTurn({
          threadId,
          input: "please respond",
        })
        .pipe(Effect.flip);
      const sessions = yield* adapter.listSessions();

      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      yield* Fiber.interrupt(abortedFiber).pipe(Effect.ignore);

      assert.strictEqual(error._tag, "ProviderAdapterRequestError");
      if (error._tag !== "ProviderAdapterRequestError") {
        throw new Error("Unexpected error type");
      }
      assert.strictEqual(error.method, "pi/stdin");
      assert.strictEqual(error.detail, "Failed to write Pi JSONL command.");
      assert.deepStrictEqual(stdinLines, []);
      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0]?.status, "ready");
      assert.strictEqual(sessions[0]?.activeTurnId, undefined);
      assert.strictEqual(sessions[0]?.lastError, "Failed to write Pi JSONL command.");
      assert.deepStrictEqual(
        abortedEvents.map((event) => event.type),
        ["turn.aborted"],
      );
      assert.deepStrictEqual(abortedEvents[0]?.payload, {
        reason: "Failed to write Pi JSONL command.",
      });
    }).pipe(Effect.scoped),
  );

  it.effect("continues reading Pi stdout after a malformed JSONL line", () =>
    Effect.gen(function* () {
      const { adapter, stdout } = yield* makePiAdapterHarness();
      const completedEvents: ProviderRuntimeEvent[] = [];
      const completedFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (event.type === "turn.completed") {
            completedEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-malformed-jsonl");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "handle noisy stdout",
      });

      yield* Queue.offer(stdout, encoder.encode("{not valid json}\n"));
      yield* Queue.offer(stdout, jsonl({ type: "turn_end", stop_reason: "complete" }));
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      const sessions = yield* adapter.listSessions();
      yield* Fiber.interrupt(completedFiber).pipe(Effect.ignore);

      assert.deepStrictEqual(
        completedEvents.map((event) => event.type),
        ["turn.completed"],
      );
      assert.deepStrictEqual(completedEvents[0]?.payload, {
        state: "completed",
        stopReason: "complete",
      });
      assert.strictEqual(sessions[0]?.status, "ready");
      assert.strictEqual(sessions[0]?.activeTurnId, undefined);
    }).pipe(Effect.scoped),
  );

  it.effect("maps pi tool execution events into canonical item lifecycle events", () =>
    Effect.gen(function* () {
      const { adapter, stdout } = yield* makePiAdapterHarness();
      const toolEvents: ProviderRuntimeEvent[] = [];
      const toolEventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (event.type === "item.started" || event.type === "item.completed") {
            toolEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-tool-events");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "list files",
      });

      yield* Queue.offer(
        stdout,
        jsonl({
          type: "tool_execution_start",
          id: "tool-1",
          name: "bash",
          input: { command: "ls" },
        }),
      );
      yield* Queue.offer(
        stdout,
        jsonl({
          type: "tool_execution_end",
          id: "tool-1",
          name: "bash",
          success: true,
          result: "done",
        }),
      );

      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      yield* Fiber.interrupt(toolEventsFiber).pipe(Effect.ignore);

      assert.deepStrictEqual(
        toolEvents.map((event) => event.type),
        ["item.started", "item.completed"],
      );
      assert.deepStrictEqual(toolEvents[0]?.payload, {
        itemType: "command_execution",
        status: "inProgress",
        title: "bash",
        data: {
          id: "tool-1",
          name: "bash",
          input: { command: "ls" },
        },
      });
      assert.deepStrictEqual(toolEvents[1]?.payload, {
        itemType: "command_execution",
        status: "completed",
        title: "bash",
        detail: "done",
        data: {
          id: "tool-1",
          name: "bash",
          success: true,
          result: "done",
        },
      });
    }).pipe(Effect.scoped),
  );

  it.effect("maps documented Pi RPC text and tool events into canonical runtime events", () =>
    Effect.gen(function* () {
      const { adapter, stdout } = yield* makePiAdapterHarness();
      const runtimeEvents: ProviderRuntimeEvent[] = [];
      const runtimeEventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (
            event.type === "content.delta" ||
            event.type === "item.started" ||
            event.type === "item.updated" ||
            event.type === "item.completed" ||
            event.type === "turn.completed"
          ) {
            runtimeEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-documented-rpc-events");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "list files",
      });

      yield* Queue.offer(
        stdout,
        jsonl({
          type: "message_update",
          assistantMessageEvent: {
            type: "text_delta",
            contentIndex: 0,
            delta: "hello from documented pi",
          },
        }),
      );
      yield* Queue.offer(
        stdout,
        jsonl({
          type: "tool_execution_start",
          toolCallId: "call-1",
          toolName: "bash",
          args: { command: "ls" },
        }),
      );
      yield* Queue.offer(
        stdout,
        jsonl({
          type: "tool_execution_update",
          toolCallId: "call-1",
          toolName: "bash",
          partialResult: {
            content: [{ type: "text", text: "partial output" }],
          },
        }),
      );
      yield* Queue.offer(
        stdout,
        jsonl({
          type: "tool_execution_end",
          toolCallId: "call-1",
          toolName: "bash",
          result: {
            content: [{ type: "text", text: "final output" }],
          },
          isError: false,
        }),
      );
      yield* Queue.offer(stdout, jsonl({ type: "turn_end", message: {}, toolResults: [] }));

      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      yield* Fiber.interrupt(runtimeEventsFiber).pipe(Effect.ignore);

      assert.deepStrictEqual(
        runtimeEvents.map((event) => event.type),
        ["content.delta", "item.started", "item.updated", "item.completed", "turn.completed"],
      );
      assert.deepStrictEqual(runtimeEvents[0]?.payload, {
        streamKind: "assistant_text",
        delta: "hello from documented pi",
        contentIndex: 0,
      });
      assert.deepStrictEqual(runtimeEvents[1]?.payload, {
        itemType: "command_execution",
        status: "inProgress",
        title: "bash",
        data: {
          id: "call-1",
          name: "bash",
          input: { command: "ls" },
        },
      });
      assert.deepStrictEqual(runtimeEvents[2]?.payload, {
        itemType: "command_execution",
        status: "inProgress",
        title: "bash",
        detail: "partial output",
        data: {
          id: "call-1",
          name: "bash",
          partialResult: {
            content: [{ type: "text", text: "partial output" }],
          },
        },
      });
      assert.deepStrictEqual(runtimeEvents[3]?.payload, {
        itemType: "command_execution",
        status: "completed",
        title: "bash",
        detail: "final output",
        data: {
          id: "call-1",
          name: "bash",
          isError: false,
          result: {
            content: [{ type: "text", text: "final output" }],
          },
        },
      });
      assert.deepStrictEqual(runtimeEvents[4]?.payload, {
        state: "completed",
        stopReason: null,
      });
    }).pipe(Effect.scoped),
  );

  it.effect("marks a session exited when the pi rpc process exits unexpectedly", () =>
    Effect.gen(function* () {
      const { adapter, exitCode } = yield* makePiAdapterHarness();
      const exitedEvents: ProviderRuntimeEvent[] = [];
      const exitedFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (event.type === "session.exited") {
            exitedEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-process-exit");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      yield* Deferred.succeed(exitCode, ChildProcessSpawner.ExitCode(1));
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      yield* Fiber.interrupt(exitedFiber).pipe(Effect.ignore);

      assert.strictEqual(yield* adapter.hasSession(threadId), false);
      assert.deepStrictEqual(
        exitedEvents.map((event) => event.type),
        ["session.exited"],
      );
      assert.deepStrictEqual(exitedEvents[0]?.payload, {
        exitKind: "error",
        recoverable: true,
        reason: "Pi RPC process exited with code 1.",
      });
    }).pipe(Effect.scoped),
  );

  it.effect("aborts the active turn when the pi rpc process exits mid-turn", () =>
    Effect.gen(function* () {
      const { adapter, exitCode } = yield* makePiAdapterHarness();
      const lifecycleEvents: ProviderRuntimeEvent[] = [];
      const lifecycleFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (event.type === "turn.aborted" || event.type === "session.exited") {
            lifecycleEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-process-exit-mid-turn");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "keep working",
      });

      yield* Deferred.succeed(exitCode, ChildProcessSpawner.ExitCode(1));
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      yield* Fiber.interrupt(lifecycleFiber).pipe(Effect.ignore);

      assert.deepStrictEqual(
        lifecycleEvents.map((event) => event.type),
        ["turn.aborted", "session.exited"],
      );
      assert.deepStrictEqual(lifecycleEvents[0]?.payload, {
        reason: "Pi RPC process exited with code 1.",
      });
      assert.deepStrictEqual(lifecycleEvents[1]?.payload, {
        exitKind: "error",
        recoverable: true,
        reason: "Pi RPC process exited with code 1.",
      });
    }).pipe(Effect.scoped),
  );

  it.effect("kills the Pi process and aborts the active turn when stopping a running session", () =>
    Effect.gen(function* () {
      const { adapter, killCalls } = yield* makePiAdapterHarness();
      const lifecycleEvents: ProviderRuntimeEvent[] = [];
      const lifecycleFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          if (event.type === "turn.aborted" || event.type === "session.exited") {
            lifecycleEvents.push(event);
          }
        }),
      ).pipe(Effect.forkChild);
      const threadId = ThreadId.make("thread-pi-stop-running-session");

      yield* adapter.startSession({
        threadId,
        provider: PI_PROVIDER,
        providerInstanceId: PI_INSTANCE,
        runtimeMode: "approval-required",
        cwd: "/tmp/pi-workspace",
      });
      yield* adapter.sendTurn({
        threadId,
        input: "keep working",
      });

      yield* adapter.stopSession(threadId);
      yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 25)));
      yield* Fiber.interrupt(lifecycleFiber).pipe(Effect.ignore);

      assert.strictEqual(yield* adapter.hasSession(threadId), false);
      assert.strictEqual(killCalls.length, 1);
      assert.deepStrictEqual(
        lifecycleEvents.map((event) => event.type),
        ["turn.aborted", "session.exited"],
      );
      assert.deepStrictEqual(lifecycleEvents[0]?.payload, {
        reason: "Pi session stopped.",
      });
      assert.deepStrictEqual(lifecycleEvents[1]?.payload, {
        exitKind: "graceful",
      });
    }).pipe(Effect.scoped),
  );
});
