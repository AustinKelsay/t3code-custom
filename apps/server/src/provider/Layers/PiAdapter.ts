import {
  ApprovalRequestId,
  EventId,
  ProviderDriverKind,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
  type PiSettings,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
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
const PI_COMMAND_RESPONSE_TIMEOUT = Duration.seconds(15);
const encoder = new TextEncoder();

export interface PiAdapterOptions {
  readonly instanceId?: ProviderSession["providerInstanceId"] | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
}

interface PiSessionContext {
  session: ProviderSession;
  readonly child: ChildProcessSpawner.ChildProcessHandle;
  activeTurnId: TurnId | undefined;
  queueModesConfigured: boolean;
  readonly pendingExtensionRequests: Map<ApprovalRequestId, PendingPiExtensionRequest>;
}

interface PendingPiResponse {
  readonly command: string;
  readonly deferred: Deferred.Deferred<void, ProviderAdapterRequestError>;
}

interface PendingPiExtensionRequest {
  readonly id: ApprovalRequestId;
  readonly method: "confirm" | "select" | "input" | "editor";
  readonly turnId: TurnId | undefined;
  readonly requestType: "command_execution_approval" | "tool_user_input";
}

interface EventBaseInput {
  readonly threadId: ThreadId;
  readonly turnId?: TurnId | undefined;
  readonly itemId?: string | undefined;
  readonly requestId?: RuntimeRequestId | undefined;
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

function stringArrayField(record: Record<string, unknown>, key: string): ReadonlyArray<string> {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
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

function piQueueDetail(steering: ReadonlyArray<string>, followUp: ReadonlyArray<string>): string {
  const parts: string[] = [];
  if (steering.length > 0) {
    parts.push(`Steering: ${steering.join(" | ")}`);
  }
  if (followUp.length > 0) {
    parts.push(`Follow-up: ${followUp.join(" | ")}`);
  }
  return parts.length > 0 ? parts.join("\n") : "Pi queue is empty.";
}

function piExtensionTitle(event: Record<string, unknown>, fallback: string): string {
  return stringField(event, "title") ?? fallback;
}

function piConfirmDetail(event: Record<string, unknown>): string {
  const title = piExtensionTitle(event, "Pi confirmation");
  const message = stringField(event, "message");
  return message ? `${title}\n${message}` : title;
}

function piQuestionPlaceholder(event: Record<string, unknown>): string {
  return stringField(event, "placeholder") ?? piExtensionTitle(event, "Pi input");
}

function piSelectOptions(event: Record<string, unknown>): ReadonlyArray<{
  readonly label: string;
  readonly description: string;
}> {
  return stringArrayField(event, "options").map((option) => ({
    label: option,
    description: option,
  }));
}

function piUserInputValue(answers: ProviderUserInputAnswers): string | undefined {
  const value = answers.value;
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (Array.isArray(value)) {
    const first = value.find((entry): entry is string => typeof entry === "string");
    return first && first.trim().length > 0 ? first : undefined;
  }
  return undefined;
}

function piExtensionApprovalDecisionResponse(decision: ProviderApprovalDecision) {
  if (decision === "cancel") {
    return { type: "extension_ui_response", cancelled: true } as const;
  }
  return {
    type: "extension_ui_response",
    confirmed: decision === "accept" || decision === "acceptForSession",
  } as const;
}

function piAdapterUnavailable(method: string) {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail: "Pi adapter support for this operation is not implemented yet.",
  });
}

function piCommandFailed(method: string, detail: string) {
  return new ProviderAdapterRequestError({
    provider: PROVIDER,
    method,
    detail,
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
    const pendingResponses = new Map<string, PendingPiResponse>();

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
          ...(input.requestId ? { requestId: input.requestId } : {}),
        })),
      );
    const emit = (event: ProviderRuntimeEvent) => Queue.offer(runtimeEvents, event);
    const piRuntimeRequestId = (requestId: ApprovalRequestId): RuntimeRequestId =>
      RuntimeRequestId.make(requestId);

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

    const emitPiExtensionRequestResolved = (
      context: PiSessionContext,
      pending: PendingPiExtensionRequest,
      input:
        | { readonly kind: "approval"; readonly decision: ProviderApprovalDecision }
        | { readonly kind: "user-input"; readonly answers: ProviderUserInputAnswers },
    ): Effect.Effect<void, ProviderAdapterRequestError> =>
      Effect.gen(function* () {
        if (input.kind === "approval") {
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId: pending.turnId,
              requestId: piRuntimeRequestId(pending.id),
            })),
            type: "request.resolved",
            payload: {
              requestType: pending.requestType,
              decision: input.decision,
            },
          });
          return;
        }

        yield* emit({
          ...(yield* buildEventBase({
            threadId: context.session.threadId,
            turnId: pending.turnId,
            requestId: piRuntimeRequestId(pending.id),
          })),
          type: "user-input.resolved",
          payload: {
            answers: input.answers,
          },
        });
      });

    const schedulePiExtensionRequestTimeout = (
      context: PiSessionContext,
      pending: PendingPiExtensionRequest,
      timeoutMs: number | undefined,
    ): Effect.Effect<void> => {
      if (timeoutMs === undefined || timeoutMs <= 0) {
        return Effect.void;
      }
      return Effect.sleep(Duration.millis(timeoutMs)).pipe(
        Effect.flatMap(() =>
          Effect.gen(function* () {
            const current = context.pendingExtensionRequests.get(pending.id);
            if (current !== pending) {
              return;
            }
            context.pendingExtensionRequests.delete(pending.id);
            yield* emitPiExtensionRequestResolved(
              context,
              pending,
              pending.method === "confirm"
                ? { kind: "approval", decision: "cancel" }
                : { kind: "user-input", answers: {} },
            );
          }),
        ),
        Effect.ignoreCause({ log: true }),
        Effect.forkIn(runtimeScope),
        Effect.asVoid,
      );
    };

    const clearPendingPiExtensionRequests = (
      context: PiSessionContext,
    ): Effect.Effect<void, ProviderAdapterRequestError> =>
      Effect.forEach(
        Array.from(context.pendingExtensionRequests.values()),
        (pending) =>
          Effect.gen(function* () {
            context.pendingExtensionRequests.delete(pending.id);
            yield* emitPiExtensionRequestResolved(
              context,
              pending,
              pending.method === "confirm"
                ? { kind: "approval", decision: "cancel" }
                : { kind: "user-input", answers: {} },
            );
          }),
        { discard: true },
      );

    const handlePiExtensionUiRequest = (
      context: PiSessionContext,
      event: Record<string, unknown>,
    ): Effect.Effect<void, ProviderAdapterRequestError> =>
      Effect.gen(function* () {
        const id = stringField(event, "id");
        const method = stringField(event, "method");
        if (!id || !method) {
          return;
        }
        const requestId = ApprovalRequestId.make(id);
        const requestRuntimeId = piRuntimeRequestId(requestId);
        const timeout = numberField(event, "timeout");

        if (method === "confirm") {
          const pending: PendingPiExtensionRequest = {
            id: requestId,
            method,
            turnId: context.activeTurnId,
            requestType: "command_execution_approval",
          };
          context.pendingExtensionRequests.set(requestId, pending);
          const title = piExtensionTitle(event, "Pi confirmation");
          const message = stringField(event, "message");
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId: pending.turnId,
              requestId: requestRuntimeId,
            })),
            type: "request.opened",
            payload: {
              requestType: "command_execution_approval",
              detail: piConfirmDetail(event),
              args: {
                id,
                method,
                title,
                ...(message ? { message } : {}),
                ...(timeout !== undefined ? { timeout } : {}),
              },
            },
          });
          yield* schedulePiExtensionRequestTimeout(context, pending, timeout);
          return;
        }

        if (method === "select" || method === "input" || method === "editor") {
          const title = piExtensionTitle(event, method === "select" ? "Pi selection" : "Pi input");
          const question =
            method === "select"
              ? title
              : (stringField(event, "prefill") ?? piQuestionPlaceholder(event));
          const options = method === "select" ? piSelectOptions(event) : [];
          const pending: PendingPiExtensionRequest = {
            id: requestId,
            method,
            turnId: context.activeTurnId,
            requestType: "tool_user_input",
          };
          context.pendingExtensionRequests.set(requestId, pending);
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId: pending.turnId,
              requestId: requestRuntimeId,
            })),
            type: "user-input.requested",
            payload: {
              questions: [
                {
                  id: "value",
                  header: title,
                  question,
                  options,
                  multiSelect: false,
                },
              ],
            },
          });
          yield* schedulePiExtensionRequestTimeout(context, pending, timeout);
        }
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
          if (responseId) {
            const pending = pendingResponses.get(responseId);
            if (pending && (!command || pending.command === command)) {
              pendingResponses.delete(responseId);
              if (event.success === false) {
                const error =
                  stringField(event, "error") ?? `Pi ${pending.command} command failed.`;
                yield* Deferred.fail(
                  pending.deferred,
                  piCommandFailed(`pi/${pending.command}`, error),
                );
              } else {
                yield* Deferred.succeed(pending.deferred, undefined);
              }
              return;
            }
          }
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

        if (type === "extension_ui_request") {
          yield* handlePiExtensionUiRequest(context, event);
          return;
        }

        if (type === "queue_update") {
          const steering = stringArrayField(event, "steering");
          const followUp = stringArrayField(event, "followUp");
          const hasQueuedMessages = steering.length > 0 || followUp.length > 0;
          yield* emit({
            ...(yield* buildEventBase({
              threadId: context.session.threadId,
              turnId: context.activeTurnId,
              itemId: "pi-queue",
            })),
            type: "item.updated",
            payload: {
              itemType: "dynamic_tool_call",
              status: hasQueuedMessages ? "inProgress" : "completed",
              title: "Pi queue",
              detail: piQueueDetail(steering, followUp),
              data: {
                id: "pi-queue",
                steering,
                followUp,
              },
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
            yield* clearPendingPiExtensionRequests(context);
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
          queueModesConfigured: false,
          pendingExtensionRequests: new Map(),
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

    const writeCommandAndAwaitResponse = (
      context: PiSessionContext,
      commandName: string,
      command: Record<string, unknown>,
    ): Effect.Effect<void, ProviderAdapterRequestError> => {
      let pendingCommandId: string | undefined;
      return Effect.gen(function* () {
        const commandId = stringField(command, "id") ?? `pi-${commandName}-${yield* nextUuid}`;
        pendingCommandId = commandId;
        const deferred = yield* Deferred.make<void, ProviderAdapterRequestError>();
        pendingResponses.set(commandId, {
          command: commandName,
          deferred,
        });
        yield* writeCommand(context, {
          ...command,
          id: commandId,
        });
        yield* Deferred.await(deferred).pipe(
          Effect.timeoutOption(PI_COMMAND_RESPONSE_TIMEOUT),
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  piCommandFailed(
                    `pi/${commandName}`,
                    `Timed out waiting for Pi ${commandName} response.`,
                  ),
                ),
              onSome: Effect.succeed,
            }),
          ),
        );
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (pendingCommandId) {
              pendingResponses.delete(pendingCommandId);
            }
          }),
        ),
      );
    };

    const ensureQueueModesConfigured = (
      context: PiSessionContext,
    ): Effect.Effect<void, ProviderAdapterRequestError> =>
      Effect.gen(function* () {
        if (context.queueModesConfigured) {
          return;
        }
        yield* writeCommand(context, {
          id: `pi-set-steering-mode-${yield* nextUuid}`,
          type: "set_steering_mode",
          mode: "one-at-a-time",
        });
        yield* writeCommand(context, {
          id: `pi-set-follow-up-mode-${yield* nextUuid}`,
          type: "set_follow_up_mode",
          mode: "one-at-a-time",
        });
        context.queueModesConfigured = true;
      });

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

    const steerTurn: PiAdapterShape["steerTurn"] = Effect.fn("steerTurn")(function* (input) {
      const context = yield* getSessionContext(input.threadId);
      if (!context.activeTurnId) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "steerTurn",
          detail: "Pi session does not have an active turn to steer.",
        });
      }
      if (context.activeTurnId !== input.expectedTurnId) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "steerTurn",
          detail: `Pi active turn '${context.activeTurnId}' does not match expected turn '${input.expectedTurnId}'.`,
        });
      }

      yield* ensureQueueModesConfigured(context);
      yield* writeCommandAndAwaitResponse(context, "steer", {
        type: "steer",
        message: input.input,
      });

      return {
        threadId: input.threadId,
        turnId: input.expectedTurnId,
      };
    });

    const interruptTurn: PiAdapterShape["interruptTurn"] = Effect.fn("interruptTurn")(
      function* (threadId, turnId) {
        const context = yield* getSessionContext(threadId);
        const activeTurnId = context.activeTurnId;
        if (!activeTurnId) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "interruptTurn",
            detail: "Pi session does not have an active turn to interrupt.",
          });
        }
        if (turnId && turnId !== activeTurnId) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "interruptTurn",
            detail: `Pi active turn '${activeTurnId}' does not match interrupt turn '${turnId}'.`,
          });
        }

        yield* writeCommandAndAwaitResponse(context, "abort", {
          type: "abort",
        });
        context.activeTurnId = undefined;
        yield* updateSession(context, {
          status: "ready",
          activeTurnId: undefined,
        });
        yield* emit({
          ...(yield* buildEventBase({ threadId, turnId: activeTurnId })),
          type: "turn.aborted",
          payload: {
            reason: "Pi turn interrupted.",
          },
        });
      },
    );

    const respondToRequest: PiAdapterShape["respondToRequest"] = Effect.fn("respondToRequest")(
      function* (threadId, requestId, decision) {
        const context = yield* getSessionContext(threadId);
        const pending = context.pendingExtensionRequests.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToRequest",
            detail: `Unknown pending Pi extension UI request: ${requestId}`,
          });
        }
        if (pending.method !== "confirm") {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "respondToRequest",
            detail: `Pending Pi extension UI request '${requestId}' is not an approval request.`,
          });
        }

        yield* writeCommand(context, {
          ...piExtensionApprovalDecisionResponse(decision),
          id: requestId,
        });
        context.pendingExtensionRequests.delete(requestId);
        yield* emitPiExtensionRequestResolved(context, pending, {
          kind: "approval",
          decision,
        });
      },
    );

    const respondToUserInput: PiAdapterShape["respondToUserInput"] = Effect.fn(
      "respondToUserInput",
    )(function* (threadId, requestId, answers) {
      const context = yield* getSessionContext(threadId);
      const pending = context.pendingExtensionRequests.get(requestId);
      if (!pending) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "respondToUserInput",
          detail: `Unknown pending Pi extension UI request: ${requestId}`,
        });
      }
      if (pending.method === "confirm") {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "respondToUserInput",
          detail: `Pending Pi extension UI request '${requestId}' is not a user-input request.`,
        });
      }

      const value = piUserInputValue(answers);
      const response =
        value === undefined
          ? { type: "extension_ui_response", id: requestId, cancelled: true }
          : { type: "extension_ui_response", id: requestId, value };
      yield* writeCommand(context, response);
      context.pendingExtensionRequests.delete(requestId);
      yield* emitPiExtensionRequestResolved(context, pending, {
        kind: "user-input",
        answers: value === undefined ? {} : { value },
      });
    });

    const stopSession: PiAdapterShape["stopSession"] = (threadId) =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context) return;
        const activeTurnId = context.activeTurnId;
        sessions.delete(threadId);
        context.activeTurnId = undefined;
        yield* clearPendingPiExtensionRequests(context);
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
        turnSteering: "native",
      },
      startSession,
      sendTurn,
      steerTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
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
