import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  type OrchestrationEvent,
  ProjectId,
  ThreadId,
  TurnQueueItemId,
  TurnSteerEntryId,
  TurnId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asMessageId = (value: string): MessageId => MessageId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);

function makeQueuedTurnRequest(messageId: MessageId, text: string) {
  return {
    message: {
      messageId,
      role: "user" as const,
      text,
      attachments: [],
    },
  };
}

async function seedThreadReadModel(now: string) {
  const withProject = await Effect.runPromise(
    projectEvent(createEmptyReadModel(now), {
      sequence: 1,
      eventId: asEventId("evt-project-create"),
      aggregateKind: "project",
      aggregateId: asProjectId("project-1"),
      type: "project.created",
      occurredAt: now,
      commandId: CommandId.make("cmd-project-create"),
      causationEventId: null,
      correlationId: CommandId.make("cmd-project-create"),
      metadata: {},
      payload: {
        projectId: asProjectId("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
  return Effect.runPromise(
    projectEvent(withProject, {
      sequence: 2,
      eventId: asEventId("evt-thread-create"),
      aggregateKind: "thread",
      aggregateId: ThreadId.make("thread-1"),
      type: "thread.created",
      occurredAt: now,
      commandId: CommandId.make("cmd-thread-create"),
      causationEventId: null,
      correlationId: CommandId.make("cmd-thread-create"),
      metadata: {},
      payload: {
        threadId: ThreadId.make("thread-1"),
        projectId: asProjectId("project-1"),
        title: "Thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
}

it.layer(NodeServices.layer)("decider project scripts", (it) => {
  it.effect("emits empty scripts on project.create", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const readModel = createEmptyReadModel(now);

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "project.create",
          commandId: CommandId.make("cmd-project-create-scripts"),
          projectId: asProjectId("project-scripts"),
          title: "Scripts",
          workspaceRoot: "/tmp/scripts",
          createdAt: now,
        },
        readModel,
      });

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("project.created");
      expect((event.payload as { scripts: unknown[] }).scripts).toEqual([]);
    }),
  );

  it.effect("propagates scripts in project.meta.update payload", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const initial = createEmptyReadModel(now);
      const readModel = yield* projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-scripts"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-scripts"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-project-create-scripts"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-project-create-scripts"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-scripts"),
          title: "Scripts",
          workspaceRoot: "/tmp/scripts",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      const scripts = [
        {
          id: "lint",
          name: "Lint",
          command: "bun run lint",
          icon: "lint",
          runOnWorktreeCreate: false,
        },
      ] as const;

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "project.meta.update",
          commandId: CommandId.make("cmd-project-update-scripts"),
          projectId: asProjectId("project-scripts"),
          scripts: Array.from(scripts),
        },
        readModel,
      });

      const event = Array.isArray(result) ? result[0] : result;
      expect(event.type).toBe("project.meta-updated");
      expect((event.payload as { scripts?: unknown[] }).scripts).toEqual(scripts);
    }),
  );

  it.effect("emits user message and turn-start-requested events for thread.turn.start", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const initial = createEmptyReadModel(now);
      const withProject = yield* projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-project-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      const readModel = yield* projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-thread-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: asMessageId("message-user-1"),
            role: "user",
            text: "hello",
            attachments: [],
          },
          modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.3-codex", [
            { id: "reasoningEffort", value: "high" },
            { id: "fastMode", value: true },
          ]),
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: now,
        },
        readModel,
      });

      expect(Array.isArray(result)).toBe(true);
      const events = Array.isArray(result) ? result : [result];
      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe("thread.message-sent");
      const turnStartEvent = events[1];
      expect(turnStartEvent?.type).toBe("thread.turn-start-requested");
      expect(turnStartEvent?.causationEventId).toBe(events[0]?.eventId ?? null);
      if (turnStartEvent?.type !== "thread.turn-start-requested") {
        return;
      }
      expect(turnStartEvent.payload).toMatchObject({
        threadId: ThreadId.make("thread-1"),
        messageId: asMessageId("message-user-1"),
        modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.3-codex", [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ]),
        runtimeMode: "approval-required",
      });
    }),
  );

  it("queues thread.turn.queue without requesting provider send", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const readModel = await seedThreadReadModel(now);

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.turn.queue",
          commandId: CommandId.make("cmd-turn-queue"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: asMessageId("message-user-queued"),
            role: "user",
            text: "queued hello",
            attachments: [],
          },
          createdAt: now,
        },
        readModel,
      }),
    );

    const events = Array.isArray(result) ? result : [result];
    expect(events.map((event) => event.type)).toEqual([
      "thread.message-sent",
      "thread.turn-queued",
    ]);
    const queuedEvent = events[1];
    expect(queuedEvent?.causationEventId).toBe(events[0]?.eventId ?? null);
    if (queuedEvent?.type !== "thread.turn-queued") {
      return;
    }
    expect(queuedEvent.payload).toMatchObject({
      threadId: ThreadId.make("thread-1"),
      request: {
        message: {
          messageId: asMessageId("message-user-queued"),
        },
      },
    });
  });

  it("records accepted steer as a steer entry on the active turn", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = ThreadId.make("thread-1");
    const activeTurnId = asTurnId("turn-active");
    const withThread = await seedThreadReadModel(now);
    const readModel = await Effect.runPromise(
      projectEvent(withThread, {
        sequence: 3,
        eventId: asEventId("evt-session-running"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.session-set",
        occurredAt: now,
        commandId: CommandId.make("cmd-session-running"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-session-running"),
        metadata: {},
        payload: {
          threadId,
          session: {
            threadId,
            status: "running",
            providerName: "codex",
            providerInstanceId: ProviderInstanceId.make("codex"),
            runtimeMode: "approval-required",
            activeTurnId,
            lastError: null,
            updatedAt: now,
          },
        },
      }),
    );

    const requested = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.turn.steer",
          commandId: CommandId.make("cmd-turn-steer"),
          threadId,
          turnId: activeTurnId,
          message: {
            messageId: asMessageId("message-steer-1"),
            role: "user",
            text: "Use the smaller refactor.",
            attachments: [],
          },
          createdAt: now,
        },
        readModel,
      }),
    );

    if (!("type" in requested)) {
      throw new Error("Expected a single steer requested event.");
    }
    expect(requested.type).toBe("thread.turn-steer-requested");
    if (requested.type !== "thread.turn-steer-requested") {
      return;
    }
    expect(requested.payload).toMatchObject({
      threadId,
      turnId: activeTurnId,
      messageId: asMessageId("message-steer-1"),
      text: "Use the smaller refactor.",
      createdAt: now,
    });

    const projected = await Effect.runPromise(
      projectEvent(readModel, {
        sequence: 4,
        eventId: asEventId("evt-steer-accepted"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.turn-steer-accepted",
        occurredAt: now,
        commandId: CommandId.make("cmd-turn-steer-accept"),
        causationEventId: requested.eventId,
        correlationId: CommandId.make("cmd-turn-steer"),
        metadata: {},
        payload: {
          threadId,
          steerEntryId: TurnSteerEntryId.make("steer-entry-1"),
          turnId: activeTurnId,
          messageId: asMessageId("message-steer-1"),
          text: "Use the smaller refactor.",
          createdAt: now,
        },
      }),
    );
    const thread = projected.threads.find((entry) => entry.id === threadId);

    expect(thread?.messages).toEqual([]);
    expect(thread?.steerEntries).toEqual([
      {
        steerEntryId: TurnSteerEntryId.make("steer-entry-1"),
        turnId: activeTurnId,
        messageId: asMessageId("message-steer-1"),
        text: "Use the smaller refactor.",
        createdAt: now,
      },
    ]);
  });

  it("rejects normal queued send start while another queued turn is sending", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = ThreadId.make("thread-1");
    const firstQueueItemId = TurnQueueItemId.make("queue-item-1");
    const secondQueueItemId = TurnQueueItemId.make("queue-item-2");
    const baseReadModel = await seedThreadReadModel(now);
    const withFirstQueued = await Effect.runPromise(
      projectEvent(baseReadModel, {
        sequence: 3,
        eventId: asEventId("evt-first-turn-queued"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.turn-queued",
        occurredAt: now,
        commandId: CommandId.make("cmd-first-turn-queued"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-first-turn-queued"),
        metadata: {},
        payload: {
          threadId,
          queueItemId: firstQueueItemId,
          request: makeQueuedTurnRequest(asMessageId("message-first-queued"), "first queued"),
          createdAt: now,
        },
      }),
    );
    const withFirstSending = await Effect.runPromise(
      projectEvent(withFirstQueued, {
        sequence: 4,
        eventId: asEventId("evt-first-queued-started"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.queued-turn-send-started",
        occurredAt: now,
        commandId: CommandId.make("cmd-first-queued-started"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-first-queued-started"),
        metadata: {},
        payload: {
          threadId,
          queueItemId: firstQueueItemId,
          messageId: asMessageId("message-first-queued"),
          createdAt: now,
        },
      }),
    );
    const withSecondQueued = await Effect.runPromise(
      projectEvent(withFirstSending, {
        sequence: 5,
        eventId: asEventId("evt-second-turn-queued"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.turn-queued",
        occurredAt: now,
        commandId: CommandId.make("cmd-second-turn-queued"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-second-turn-queued"),
        metadata: {},
        payload: {
          threadId,
          queueItemId: secondQueueItemId,
          request: makeQueuedTurnRequest(asMessageId("message-second-queued"), "second queued"),
          createdAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withSecondQueued, {
        sequence: 6,
        eventId: asEventId("evt-session-ready"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.session-set",
        occurredAt: now,
        commandId: CommandId.make("cmd-session-ready"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-session-ready"),
        metadata: {},
        payload: {
          threadId,
          session: {
            threadId,
            status: "ready",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: null,
            lastError: null,
            updatedAt: now,
          },
        },
      }),
    );

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.queued-turn.send.start",
            commandId: CommandId.make("cmd-normal-send-start"),
            threadId,
            mode: "normal",
            createdAt: now,
          },
          readModel,
        }),
      ),
    ).rejects.toThrow("already has a queued turn being sent");
  });

  it("emits queued send started and shared turn-start-requested when starting a queued turn", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = ThreadId.make("thread-1");
    const queueItemId = TurnQueueItemId.make("queue-item-1");
    const baseReadModel = await seedThreadReadModel(now);
    const withQueuedTurn = await Effect.runPromise(
      projectEvent(baseReadModel, {
        sequence: 3,
        eventId: asEventId("evt-turn-queued"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.turn-queued",
        occurredAt: now,
        commandId: CommandId.make("cmd-turn-queued"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-turn-queued"),
        metadata: {},
        payload: {
          threadId,
          queueItemId,
          request: makeQueuedTurnRequest(asMessageId("message-user-queued"), "queued hello"),
          createdAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withQueuedTurn, {
        sequence: 4,
        eventId: asEventId("evt-session-ready-for-queued-send"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.session-set",
        occurredAt: now,
        commandId: CommandId.make("cmd-session-ready-for-queued-send"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-session-ready-for-queued-send"),
        metadata: {},
        payload: {
          threadId,
          session: {
            threadId,
            status: "ready",
            providerName: "codex",
            runtimeMode: "approval-required",
            activeTurnId: null,
            lastError: null,
            updatedAt: now,
          },
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.queued-turn.send.start",
          commandId: CommandId.make("cmd-queued-send-start"),
          threadId,
          mode: "normal",
          createdAt: now,
        },
        readModel,
      }),
    );

    expect(Array.isArray(result)).toBe(true);
    const events = Array.isArray(result) ? result : [result];
    expect(events.map((event) => event.type)).toEqual([
      "thread.queued-turn-send-started",
      "thread.turn-start-requested",
    ]);
    const turnStartRequestedEvent = events[1];
    expect(turnStartRequestedEvent?.causationEventId).toBe(events[0]?.eventId ?? null);
    if (turnStartRequestedEvent?.type !== "thread.turn-start-requested") {
      return;
    }
    expect(turnStartRequestedEvent.payload).toMatchObject({
      threadId,
      queueItemId,
      messageId: asMessageId("message-user-queued"),
      queuedRequest: {
        message: {
          messageId: asMessageId("message-user-queued"),
          text: "queued hello",
        },
      },
      runtimeMode: "approval-required",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    });
  });

  it("requeues failed queued turns back to pending", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = ThreadId.make("thread-1");
    const queueItemId = TurnQueueItemId.make("queue-item-1");
    const baseReadModel = await seedThreadReadModel(now);
    const withQueuedTurn = await Effect.runPromise(
      projectEvent(baseReadModel, {
        sequence: 3,
        eventId: asEventId("evt-turn-queued-for-retry"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.turn-queued",
        occurredAt: now,
        commandId: CommandId.make("cmd-turn-queued-for-retry"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-turn-queued-for-retry"),
        metadata: {},
        payload: {
          threadId,
          queueItemId,
          request: makeQueuedTurnRequest(
            asMessageId("message-user-queued-retry"),
            "queued retry hello",
          ),
          createdAt: now,
        },
      }),
    );
    const withSendingTurn = await Effect.runPromise(
      projectEvent(withQueuedTurn, {
        sequence: 4,
        eventId: asEventId("evt-turn-sending-for-retry"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.queued-turn-send-started",
        occurredAt: now,
        commandId: CommandId.make("cmd-turn-sending-for-retry"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-turn-sending-for-retry"),
        metadata: {},
        payload: {
          threadId,
          queueItemId,
          messageId: asMessageId("message-user-queued-retry"),
          createdAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withSendingTurn, {
        sequence: 5,
        eventId: asEventId("evt-turn-failed-for-retry"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.queued-turn-send-failed",
        occurredAt: now,
        commandId: CommandId.make("cmd-turn-failed-for-retry"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-turn-failed-for-retry"),
        metadata: {},
        payload: {
          threadId,
          queueItemId,
          messageId: asMessageId("message-user-queued-retry"),
          reason: "Provider send failed.",
          createdAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.queued-turn.retry",
          commandId: CommandId.make("cmd-queued-turn-retry"),
          threadId,
          queueItemId,
          createdAt: now,
        },
        readModel,
      }),
    );

    expect("type" in result).toBe(true);
    if (!("type" in result)) {
      throw new Error("Expected a single queued turn removal event.");
    }
    expect(result).toMatchObject({
      type: "thread.queued-turn-requeued",
      payload: {
        threadId,
        queueItemId,
      },
    });
  });

  it("removes pending queued turns from projected thread state", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = ThreadId.make("thread-1");
    const queueItemId = TurnQueueItemId.make("queue-item-1");
    const baseReadModel = await seedThreadReadModel(now);
    const readModel = await Effect.runPromise(
      projectEvent(baseReadModel, {
        sequence: 3,
        eventId: asEventId("evt-turn-queued-for-remove"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.turn-queued",
        occurredAt: now,
        commandId: CommandId.make("cmd-turn-queued-for-remove"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-turn-queued-for-remove"),
        metadata: {},
        payload: {
          threadId,
          queueItemId,
          request: makeQueuedTurnRequest(asMessageId("message-user-queued-remove"), "remove me"),
          createdAt: now,
        },
      }),
    );

    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.queued-turn.remove",
          commandId: CommandId.make("cmd-queued-turn-remove"),
          threadId,
          queueItemId,
          createdAt: now,
        },
        readModel,
      }),
    );

    expect("type" in result).toBe(true);
    if (!("type" in result)) {
      throw new Error("Expected a single queued turn removal event.");
    }
    expect(result).toMatchObject({
      type: "thread.queued-turn-removed",
      payload: {
        threadId,
        queueItemId,
        messageId: asMessageId("message-user-queued-remove"),
      },
    });
    if (result.type !== "thread.queued-turn-removed") {
      throw new Error(`Expected queued turn removed event, received ${result.type}.`);
    }
    const removedEvent = result as Omit<
      Extract<OrchestrationEvent, { readonly type: "thread.queued-turn-removed" }>,
      "sequence"
    >;

    const projected = await Effect.runPromise(
      projectEvent(readModel, { ...removedEvent, sequence: readModel.snapshotSequence + 1 }),
    );
    expect(projected.threads.find((thread) => thread.id === threadId)?.queuedTurns).toEqual([]);
  });

  it("rejects removing queued turns that are sending", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const threadId = ThreadId.make("thread-1");
    const queueItemId = TurnQueueItemId.make("queue-item-1");
    const baseReadModel = await seedThreadReadModel(now);
    const withQueuedTurn = await Effect.runPromise(
      projectEvent(baseReadModel, {
        sequence: 3,
        eventId: asEventId("evt-turn-queued-sending-remove"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.turn-queued",
        occurredAt: now,
        commandId: CommandId.make("cmd-turn-queued-sending-remove"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-turn-queued-sending-remove"),
        metadata: {},
        payload: {
          threadId,
          queueItemId,
          request: makeQueuedTurnRequest(asMessageId("message-user-sending-remove"), "sending"),
          createdAt: now,
        },
      }),
    );
    const readModel = await Effect.runPromise(
      projectEvent(withQueuedTurn, {
        sequence: 4,
        eventId: asEventId("evt-turn-sending-remove"),
        aggregateKind: "thread",
        aggregateId: threadId,
        type: "thread.queued-turn-send-started",
        occurredAt: now,
        commandId: CommandId.make("cmd-turn-sending-remove"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-turn-sending-remove"),
        metadata: {},
        payload: {
          threadId,
          queueItemId,
          messageId: asMessageId("message-user-sending-remove"),
          createdAt: now,
        },
      }),
    );

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          command: {
            type: "thread.queued-turn.remove",
            commandId: CommandId.make("cmd-remove-sending"),
            threadId,
            queueItemId,
            createdAt: now,
          },
          readModel,
        }),
      ),
    ).rejects.toThrow("is sending and cannot be removed");
  });

  it("emits thread.runtime-mode-set from thread.runtime-mode.set", async () => {
    const now = "2026-01-01T00:00:00.000Z";
    const initial = createEmptyReadModel(now);
    const withProject = await Effect.runPromise(
      projectEvent(initial, {

  it.effect("emits thread.runtime-mode-set from thread.runtime-mode.set", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const initial = createEmptyReadModel(now);
      const withProject = yield* projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-project-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      const readModel = yield* projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-thread-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.runtime-mode.set",
          commandId: CommandId.make("cmd-runtime-mode-set"),
          threadId: ThreadId.make("thread-1"),
          runtimeMode: "approval-required",
          createdAt: now,
        },
        readModel,
      });

      const singleResult = Array.isArray(result) ? null : result;
      if (singleResult === null) {
        throw new Error("Expected a single runtime-mode-set event.");
      }
      expect(singleResult).toMatchObject({
        type: "thread.runtime-mode-set",
        payload: {
          threadId: ThreadId.make("thread-1"),
          runtimeMode: "approval-required",
        },
      });
    }),
  );

  it.effect("emits thread.interaction-mode-set from thread.interaction-mode.set", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const initial = createEmptyReadModel(now);
      const withProject = yield* projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create"),
        aggregateKind: "project",
        aggregateId: asProjectId("project-1"),
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-project-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-project-create"),
        metadata: {},
        payload: {
          projectId: asProjectId("project-1"),
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      const readModel = yield* projectEvent(withProject, {
        sequence: 2,
        eventId: asEventId("evt-thread-create"),
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        type: "thread.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-thread-create"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-thread-create"),
        metadata: {},
        payload: {
          threadId: ThreadId.make("thread-1"),
          projectId: asProjectId("project-1"),
          title: "Thread",
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.interaction-mode.set",
          commandId: CommandId.make("cmd-interaction-mode-set"),
          threadId: ThreadId.make("thread-1"),
          interactionMode: "plan",
          createdAt: now,
        },
        readModel,
      });

      const singleResult = Array.isArray(result) ? null : result;
      if (singleResult === null) {
        throw new Error("Expected a single interaction-mode-set event.");
      }
      expect(singleResult).toMatchObject({
        type: "thread.interaction-mode-set",
        payload: {
          threadId: ThreadId.make("thread-1"),
          interactionMode: "plan",
        },
      });
    }),
  );
});
