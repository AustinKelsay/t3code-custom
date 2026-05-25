import type {
  OrchestrationEvent,
  OrchestrationQueuedTurn,
  ThreadId,
  ThreadQueuedTurnRequest,
  TurnQueueItemId,
} from "@t3tools/contracts";

type QueuedTurnPayload<T extends OrchestrationEvent["type"]> = Extract<
  OrchestrationEvent,
  { readonly type: T }
>["payload"];

export type QueuedTurnLifecycleEvent =
  | {
      readonly type: "thread.turn-queued";
      readonly payload: QueuedTurnPayload<"thread.turn-queued">;
    }
  | {
      readonly type: "thread.queued-turn-send-started";
      readonly payload: QueuedTurnPayload<"thread.queued-turn-send-started">;
    }
  | {
      readonly type: "thread.queued-turn-send-failed";
      readonly payload: QueuedTurnPayload<"thread.queued-turn-send-failed">;
    }
  | {
      readonly type: "thread.queued-turn-requeued";
      readonly payload: QueuedTurnPayload<"thread.queued-turn-requeued">;
    }
  | {
      readonly type: "thread.queued-turn-removed";
      readonly payload: QueuedTurnPayload<"thread.queued-turn-removed">;
    }
  | {
      readonly type: "thread.queued-turn-resolved";
      readonly payload: QueuedTurnPayload<"thread.queued-turn-resolved">;
    };

export type QueuedTurnLifecycleOperation =
  | {
      readonly kind: "upsert";
      readonly threadId: ThreadId;
      readonly queuedTurn: OrchestrationQueuedTurn;
    }
  | {
      readonly kind: "update";
      readonly threadId: ThreadId;
      readonly queueItemId: TurnQueueItemId;
      readonly patch: Pick<OrchestrationQueuedTurn, "status" | "failureReason" | "updatedAt">;
    }
  | {
      readonly kind: "delete";
      readonly threadId: ThreadId;
      readonly queueItemId: TurnQueueItemId;
    };

export function queuedTurnRequestForOperation(
  operation: QueuedTurnLifecycleOperation,
): ThreadQueuedTurnRequest | null {
  return operation.kind === "upsert" ? operation.queuedTurn.request : null;
}

export function getQueuedTurnLifecycleOperation(
  event: QueuedTurnLifecycleEvent,
): QueuedTurnLifecycleOperation {
  switch (event.type) {
    case "thread.turn-queued":
      return {
        kind: "upsert",
        threadId: event.payload.threadId,
        queuedTurn: {
          queueItemId: event.payload.queueItemId,
          request: event.payload.request,
          status: "pending",
          failureReason: null,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.createdAt,
        },
      };

    case "thread.queued-turn-send-started":
      return {
        kind: "update",
        threadId: event.payload.threadId,
        queueItemId: event.payload.queueItemId,
        patch: {
          status: "sending",
          failureReason: null,
          updatedAt: event.payload.createdAt,
        },
      };

    case "thread.queued-turn-send-failed":
      return {
        kind: "update",
        threadId: event.payload.threadId,
        queueItemId: event.payload.queueItemId,
        patch: {
          status: "failed",
          failureReason: event.payload.reason,
          updatedAt: event.payload.createdAt,
        },
      };

    case "thread.queued-turn-requeued":
      return {
        kind: "update",
        threadId: event.payload.threadId,
        queueItemId: event.payload.queueItemId,
        patch: {
          status: "pending",
          failureReason: null,
          updatedAt: event.payload.createdAt,
        },
      };

    case "thread.queued-turn-resolved":
    case "thread.queued-turn-removed":
      return {
        kind: "delete",
        threadId: event.payload.threadId,
        queueItemId: event.payload.queueItemId,
      };
  }
}

export function applyQueuedTurnLifecycleOperation(
  queuedTurns: ReadonlyArray<OrchestrationQueuedTurn>,
  operation: QueuedTurnLifecycleOperation,
): OrchestrationQueuedTurn[] {
  switch (operation.kind) {
    case "upsert":
      return queuedTurns.some((entry) => entry.queueItemId === operation.queuedTurn.queueItemId)
        ? queuedTurns.map((entry) =>
            entry.queueItemId === operation.queuedTurn.queueItemId ? operation.queuedTurn : entry,
          )
        : [...queuedTurns, operation.queuedTurn];

    case "update":
      return queuedTurns.map((entry) =>
        entry.queueItemId === operation.queueItemId
          ? Object.assign({}, entry, operation.patch)
          : entry,
      );

    case "delete":
      return queuedTurns.filter((entry) => entry.queueItemId !== operation.queueItemId);
  }
}

export function applyQueuedTurnLifecycleEvent(
  queuedTurns: ReadonlyArray<OrchestrationQueuedTurn>,
  event: QueuedTurnLifecycleEvent,
): OrchestrationQueuedTurn[] {
  return applyQueuedTurnLifecycleOperation(queuedTurns, getQueuedTurnLifecycleOperation(event));
}
