import {
  CommandId,
  type OrchestrationEvent,
  type OrchestrationThread,
  type OrchestrationQueuedTurn,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  QueuedTurnDrainReactor,
  type QueuedTurnDrainReactorShape,
} from "../Services/QueuedTurnDrainReactor.ts";

type QueueDrainTriggerEvent = Extract<
  OrchestrationEvent,
  {
    type: "thread.turn-queued" | "thread.session-set" | "thread.queued-turn-requeued";
  }
>;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

type DrainMode = "normal" | "recover";

function getQueuedTurnDrainMode(thread: OrchestrationThread): DrainMode | null {
  if (thread.session?.status !== "ready") {
    return null;
  }
  if (thread.queuedTurns.some((entry: OrchestrationQueuedTurn) => entry.status === "sending")) {
    return "recover";
  }
  if (thread.queuedTurns.some((entry: OrchestrationQueuedTurn) => entry.status === "pending")) {
    return "normal";
  }
  return null;
}

const canDrainWithMode = (thread: OrchestrationThread, mode: DrainMode) =>
  getQueuedTurnDrainMode(thread) === mode;

const make = Effect.fn("makeQueuedTurnDrainReactor")(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const serverCommandId = (tag: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((id) => CommandId.make(`server:${tag}:${id}`)));

  const dispatchDrainIfReady = Effect.fn("dispatchDrainIfReady")(function* (
    threadId: ThreadId,
    mode: DrainMode,
  ) {
    const snapshot = yield* projectionSnapshotQuery.getCommandReadModel();
    const thread = snapshot.threads.find((entry) => entry.id === threadId);
    if (!thread) {
      return;
    }
    if (!canDrainWithMode(thread, mode)) {
      return;
    }

    yield* orchestrationEngine
      .dispatch({
        type: "thread.queued-turn.send.start",
        commandId: yield* serverCommandId("queued-turn-send-start"),
        threadId,
        mode,
        createdAt: yield* nowIso,
      })
      .pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning("queued turn drain failed to claim next turn", {
            threadId,
            cause: Cause.pretty(cause),
          });
        }),
      );
  });

  const processEvent = Effect.fn("processEvent")(function* (event: QueueDrainTriggerEvent) {
    yield* dispatchDrainIfReady(event.payload.threadId, "normal");
  });

  const processEventSafely = (event: QueueDrainTriggerEvent) =>
    processEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("queued turn drain reactor failed to process event", {
          eventType: event.type,
          threadId: event.payload.threadId,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processEventSafely);

  const enqueueInitialDrainAttempts = Effect.fn("enqueueInitialDrainAttempts")(function* () {
    const snapshot = yield* projectionSnapshotQuery.getCommandReadModel();
    const recoverThreadIds = new Set(
      snapshot.threads
        .filter((thread) => getQueuedTurnDrainMode(thread) === "recover")
        .map((thread) => thread.id),
    );
    const normalThreadIds = snapshot.threads
      .filter((thread) => getQueuedTurnDrainMode(thread) === "normal")
      .map((thread) => thread.id);

    yield* Effect.forEach(
      recoverThreadIds,
      (threadId) => dispatchDrainIfReady(threadId, "recover"),
      {
        concurrency: 1,
      },
    );
    yield* Effect.forEach(normalThreadIds, (threadId) => dispatchDrainIfReady(threadId, "normal"), {
      concurrency: 1,
    });
  });

  const start: QueuedTurnDrainReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (
          event.type === "thread.turn-queued" ||
          event.type === "thread.session-set" ||
          event.type === "thread.queued-turn-requeued"
        ) {
          return worker.enqueue(event);
        }
        return Effect.void;
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("queued turn drain reactor stream failed", {
            cause: Cause.pretty(cause),
          }),
        ),
      ),
    );
    yield* Effect.yieldNow;
    yield* enqueueInitialDrainAttempts().pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("queued turn drain reactor failed initial drain scan", {
          cause: Cause.pretty(cause),
        }),
      ),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies QueuedTurnDrainReactorShape;
});

export const QueuedTurnDrainReactorLive = Layer.effect(QueuedTurnDrainReactor, make());
