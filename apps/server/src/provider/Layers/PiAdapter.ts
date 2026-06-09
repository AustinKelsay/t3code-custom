import {
  EventId,
  ProviderDriverKind,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type PiSettings,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
} from "../Errors.ts";
import type { PiAdapterShape } from "../Services/PiAdapter.ts";

const PROVIDER = ProviderDriverKind.make("pi");
const encoder = new TextEncoder();

export interface PiAdapterOptions {
  readonly instanceId?: ProviderSession["providerInstanceId"] | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
}

interface PiSessionContext {
  session: ProviderSession;
  readonly child: ChildProcessSpawner.ChildProcessHandle;
  activeTurnId: TurnId | undefined;
}

interface EventBaseInput {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId | undefined;
  readonly itemId?: string | undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function piResultDetail(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : undefined;
  }
  if (!isObject(value)) return undefined;
  const content = value.content;
  if (!Array.isArray(content)) return undefined;
  const text = content
    .map((entry) => (isObject(entry) ? stringField(entry, "text") : undefined))
    .filter((entry): entry is string => entry !== undefined)
    .join("");
  return text.trim().length > 0 ? text : undefined;
}

function piToolItemType(toolName: string | undefined): "command_execution" | "dynamic_tool_call" {
  const normalized = toolName?.toLowerCase();
  return normalized === "bash" || normalized === "shell" || normalized === "command"
    ? "command_execution"
    : "dynamic_tool_call";
}

function piAdapterUnavailable(method: string) {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: "Pi adapter support for this operation is not implemented yet.",
  });
}

export function makePiAdapter(
  piSettings: PiSettings,
  options: PiAdapterOptions = {},
): Effect.Effect<
  PiAdapterShape,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | Scope.Scope
> {
  return Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const runtimeScope = yield* Effect.scope;
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, PiSessionContext>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const nextUuid = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate Pi runtime identifier.",
            cause,
          }),
      ),
    );
    const buildEventBase = (input: EventBaseInput) =>
      Effect.all({
        eventId: nextUuid.pipe(Effect.map(EventId.make)),
        createdAt: nowIso,
      }).pipe(
        Effect.map(({ eventId, createdAt }) => ({
          eventId,
          provider: PROVIDER,
          ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
          threadId: input.threadId,
          createdAt,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          ...(input.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
        })),
      );
    const emit = (event: ProviderRuntimeEvent) => Queue.offer(runtimeEvents, event);

    const updateSession = (
      context: PiSessionContext,
      patch: Partial<ProviderSession>,
    ): Effect.Effect<ProviderSession> =>
      Effect.gen(function* () {
        const updatedAt = yield* nowIso;
        const nextSession: ProviderSession = {
          ...context.session,
          ...patch,
          updatedAt,
        };
        context.session = nextSession;
        return nextSession;
      });

    const handlePiEvent = (
      context: PiSessionContext,
      event: unknown,
    ): Effect.Effect<void, ProviderAdapterRequestError> =>
      Effect.gen(function* () {
        if (!isObject(event)) return;
        const type = stringField(event, "type");
        if (type === "response") {
          const command = stringField(event, "command");
          const responseId = stringField(event, "id");
          const activeTurnId = context.activeTurnId;
          if (
            command !== "prompt" ||
            event.success !== false ||
            !activeTurnId ||
            (responseId && responseId !== activeTurnId)
          ) {
            return;
          }
          const error = stringField(event, "error") ?? "Pi rejected the prompt.";
          context.activeTurnId = undefined;
          yield* updateSession(context, {
            status: "ready",
            activeTurnId: undefined,
            lastError: error,
          });
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId: activeTurnId,
            })),
            type: "turn.aborted",
            payload: {
              reason: error,
            },
          });
          return;
        }

        if (type === "message_update") {
          const delta = event.assistantMessageEvent ?? event.delta;
          if (!isObject(delta)) return;
          const deltaType = stringField(delta, "type");
          const text = stringField(delta, "delta") ?? stringField(delta, "text");
          if (!text || !context.activeTurnId) return;
          const streamKind = deltaType === "thinking_delta" ? "reasoning_text" : "assistant_text";
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId: context.activeTurnId,
              itemId: stringField(event, "message_id"),
            })),
            type: "content.delta",
            payload: {
              streamKind,
              delta: text,
              ...(numberField(delta, "contentIndex") !== undefined
                ? { contentIndex: numberField(delta, "contentIndex") }
                : {}),
            },
          });
          return;
        }

        if (type === "tool_execution_start") {
          const id = stringField(event, "toolCallId") ?? stringField(event, "id");
          const name = stringField(event, "toolName") ?? stringField(event, "name") ?? "Pi tool";
          const input = event.args ?? event.input;
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId: context.activeTurnId,
              itemId: id,
            })),
            type: "item.started",
            payload: {
              itemType: piToolItemType(name),
              status: "inProgress",
              title: name,
              data: {
                ...(id ? { id } : {}),
                name,
                ...(input !== undefined ? { input } : {}),
              },
            },
          });
          return;
        }

        if (type === "tool_execution_update") {
          const id = stringField(event, "toolCallId") ?? stringField(event, "id");
          const name = stringField(event, "toolName") ?? stringField(event, "name") ?? "Pi tool";
          const partialResult = event.partialResult ?? event.result ?? event.output;
          const detail = piResultDetail(partialResult);
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId: context.activeTurnId,
              itemId: id,
            })),
            type: "item.updated",
            payload: {
              itemType: piToolItemType(name),
              status: "inProgress",
              title: name,
              ...(detail ? { detail } : {}),
              data: {
                ...(id ? { id } : {}),
                name,
                ...(partialResult !== undefined ? { partialResult } : {}),
              },
            },
          });
          return;
        }

        if (type === "tool_execution_end") {
          const id = stringField(event, "toolCallId") ?? stringField(event, "id");
          const name = stringField(event, "toolName") ?? stringField(event, "name") ?? "Pi tool";
          const result = event.result ?? event.output;
          const detail = piResultDetail(result);
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId: context.activeTurnId,
              itemId: id,
            })),
            type: "item.completed",
            payload: {
              itemType: piToolItemType(name),
              status: event.success === false || event.isError === true ? "failed" : "completed",
              title: name,
              ...(detail ? { detail } : {}),
              data: {
                ...(id ? { id } : {}),
                name,
                ...(typeof event.success === "boolean" ? { success: event.success } : {}),
                ...(typeof event.isError === "boolean" ? { isError: event.isError } : {}),
                ...(event.result !== undefined ? { result: event.result } : {}),
                ...(event.output !== undefined ? { output: event.output } : {}),
              },
            },
          });
          return;
        }

        if (type === "turn_end" || type === "agent_end") {
          const activeTurnId = context.activeTurnId;
          if (!activeTurnId) return;
          context.activeTurnId = undefined;
          yield* updateSession(context, {
            status: "ready",
            activeTurnId: undefined,
          });
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId: activeTurnId,
            })),
            type: "turn.completed",
            payload: {
              state: "completed",
              stopReason: stringField(event, "stop_reason") ?? null,
            },
          });
        }
      });

    const readPiJsonLines = (
      context: PiSessionContext,
    ): Effect.Effect<void, ProviderAdapterRequestError> => {
      let buffer = "";
      return context.child.stdout.pipe(
        Stream.decodeText(),
        Stream.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "pi/stdout",
              detail: "Failed to read Pi stdout.",
              cause,
            }),
        ),
        Stream.runForEach((chunk) =>
          Effect.gen(function* () {
            buffer += chunk;
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.length === 0) continue;
              let parsedEvent: unknown;
              try {
                parsedEvent = JSON.parse(trimmed) as unknown;
              } catch {
                continue;
              }
              yield* handlePiEvent(context, parsedEvent);
            }
          }),
        ),
      );
    };

    const watchPiProcessExit = (context: PiSessionContext): Effect.Effect<void> =>
      context.child.exitCode.pipe(
        Effect.map(Number),
        Effect.flatMap((exitCode) =>
          Effect.gen(function* () {
            if (sessions.get(context.session.threadId) !== context) {
              return;
            }
            const activeTurnId = context.activeTurnId;
            const reason = `Pi RPC process exited with code ${exitCode}.`;
            sessions.delete(context.session.threadId);
            context.activeTurnId = undefined;
            yield* updateSession(context, {
              status: exitCode === 0 ? "closed" : "error",
              activeTurnId: undefined,
            });
            if (activeTurnId) {
              yield* emit({
                ...(yield* buildEventBase({
                  threadId: context.session.threadId,
                  turnId: activeTurnId,
                })),
                type: "turn.aborted",
                payload: {
                  reason,
                },
              });
            }
            yield* emit({
              ...(yield* buildEventBase({ threadId: context.session.threadId })),
              type: "session.exited",
              payload: {
                exitKind: exitCode === 0 ? "graceful" : "error",
                ...(exitCode === 0 ? {} : { recoverable: true }),
                reason,
              },
            });
          }),
        ),
        Effect.ignoreCause({ log: true }),
      );

    const startSession: PiAdapterShape["startSession"] = (input) =>
      Effect.gen(function* () {
        if (input.provider && input.provider !== PROVIDER) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "startSession",
            detail: `Cannot start Pi session for provider ${input.provider}.`,
          });
        }
        if (
          input.providerInstanceId &&
          options.instanceId &&
          input.providerInstanceId !== options.instanceId
        ) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "startSession",
            detail: `Cannot start Pi session for provider instance ${input.providerInstanceId}.`,
          });
        }

        const existing = sessions.get(input.threadId);
        if (existing) {
          return existing.session;
        }

        const now = yield* nowIso;
        const command = ChildProcess.make(
          piSettings.binaryPath,
          ["--mode", "rpc", "--session-id", input.threadId],
          {
            ...(input.cwd ? { cwd: input.cwd } : {}),
            ...(options.environment ? { env: options.environment, extendEnv: true } : {}),
            shell: process.platform === "win32",
          },
        );
        const child = yield* spawner.spawn(command).pipe(
          Effect.provideService(Scope.Scope, runtimeScope),
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: input.threadId,
                detail: "Failed to start Pi RPC process.",
                cause,
              }),
          ),
        );
        const session: ProviderSession = {
          provider: PROVIDER,
          ...(options.instanceId ? { providerInstanceId: options.instanceId } : {}),
          status: "ready",
          runtimeMode: input.runtimeMode,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
          threadId: input.threadId,
          createdAt: now,
          updatedAt: now,
        };
        const context: PiSessionContext = {
          session,
          child,
          activeTurnId: undefined,
        };
        sessions.set(input.threadId, context);
        yield* readPiJsonLines(context).pipe(
          Effect.ignoreCause({ log: true }),
          Effect.forkIn(runtimeScope),
        );
        yield* watchPiProcessExit(context).pipe(Effect.forkIn(runtimeScope));
        yield* emit({
          ...(yield* buildEventBase({ threadId: input.threadId })),
          type: "session.started",
          payload: {},
        });
        yield* emit({
          ...(yield* buildEventBase({ threadId: input.threadId })),
          type: "thread.started",
          payload: {
            providerThreadId: input.threadId,
          },
        });
        return session;
      });

    const getSessionContext = (
      threadId: ThreadId,
    ): Effect.Effect<PiSessionContext, ProviderAdapterSessionNotFoundError> => {
      const context = sessions.get(threadId);
      return context
        ? Effect.succeed(context)
        : Effect.fail(
            new ProviderAdapterSessionNotFoundError({
              provider: PROVIDER,
              threadId,
            }),
          );
    };

    const writeCommand = (
      context: PiSessionContext,
      command: Record<string, unknown>,
    ): Effect.Effect<void, ProviderAdapterRequestError> =>
      Stream.run(
        Stream.make(encoder.encode(`${JSON.stringify(command)}\n`)),
        context.child.stdin,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "pi/stdin",
              detail: "Failed to write Pi JSONL command.",
              cause,
            }),
        ),
      );

    const sendTurn: PiAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const context = yield* getSessionContext(input.threadId);
        const message = input.input?.trim();
        if (!message) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "sendTurn",
            detail: "Pi sendTurn requires a non-empty input prompt.",
          });
        }
        if (context.activeTurnId) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "sendTurn",
            detail: "Pi session already has an active turn.",
          });
        }

        const turnId = TurnId.make(`pi-turn-${yield* nextUuid}`);
        context.activeTurnId = turnId;
        yield* updateSession(context, {
          status: "running",
          activeTurnId: turnId,
          ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
        });
        yield* emit({
          ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
          type: "turn.started",
          payload: input.modelSelection?.model ? { model: input.modelSelection.model } : {},
        });
        yield* writeCommand(context, {
          id: turnId,
          type: "prompt",
          message,
        }).pipe(
          Effect.tapError((requestError) =>
            Effect.gen(function* () {
              context.activeTurnId = undefined;
              yield* updateSession(context, {
                status: "ready",
                activeTurnId: undefined,
                lastError: requestError.detail,
              });
              yield* emit({
                ...(yield* buildEventBase({ threadId: input.threadId, turnId })),
                type: "turn.aborted",
                payload: {
                  reason: requestError.detail,
                },
              });
            }),
          ),
        );

        return {
          threadId: input.threadId,
          turnId,
        };
      });

    const stopSession: PiAdapterShape["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context) return;
        const activeTurnId = context.activeTurnId;
        sessions.delete(threadId);
        context.activeTurnId = undefined;
        yield* context.child.kill().pipe(Effect.ignore);
        if (activeTurnId) {
          yield* emit({
            ...(yield* buildEventBase({ threadId, turnId: activeTurnId })),
            type: "turn.aborted",
            payload: {
              reason: "Pi session stopped.",
            },
          });
        }
        yield* emit({
          ...(yield* buildEventBase({ threadId })),
          type: "session.exited",
          payload: {
            exitKind: "graceful",
          },
        });
      });

    return {
      provider: PROVIDER,
      capabilities: {
        sessionModelSwitch: "unsupported",
        turnSteering: "unsupported",
      },
      startSession,
      sendTurn,
      steerTurn: () => Effect.fail(piAdapterUnavailable("steerTurn")),
      interruptTurn: () => Effect.fail(piAdapterUnavailable("interruptTurn")),
      respondToRequest: () => Effect.fail(piAdapterUnavailable("respondToRequest")),
      respondToUserInput: () => Effect.fail(piAdapterUnavailable("respondToUserInput")),
      stopSession,
      listSessions: () =>
        Effect.succeed(Array.from(sessions.values()).map((entry) => entry.session)),
      hasSession: (threadId) => Effect.succeed(sessions.has(threadId)),
      readThread: () => Effect.fail(piAdapterUnavailable("readThread")),
      rollbackThread: () => Effect.fail(piAdapterUnavailable("rollbackThread")),
      stopAll: () =>
        Effect.forEach(Array.from(sessions.keys()), (threadId) => stopSession(threadId), {
          discard: true,
        }),
      get streamEvents() {
        return Stream.fromQueue(runtimeEvents);
      },
    } satisfies PiAdapterShape;
  });
}
