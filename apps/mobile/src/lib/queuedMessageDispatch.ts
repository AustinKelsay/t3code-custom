import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ClientOrchestrationCommand } from "@t3tools/contracts";

import type { QueuedThreadMessage } from "../state/thread-outbox-model";

type QueuedMessageDispatchCommand = Extract<
  ClientOrchestrationCommand,
  { type: "thread.turn.start" | "thread.turn.queue" }
>;

export function buildQueuedMessageDispatchCommand(input: {
  readonly queuedMessage: QueuedThreadMessage;
  readonly thread: Pick<
    EnvironmentThreadShell,
    "id" | "runtimeMode" | "interactionMode" | "session"
  >;
}): QueuedMessageDispatchCommand {
  const message = {
    messageId: input.queuedMessage.messageId,
    role: "user" as const,
    text: input.queuedMessage.text,
    attachments: [...input.queuedMessage.attachments],
  };
  const threadStatus = input.thread.session?.status;

  if (threadStatus === "running" || threadStatus === "starting") {
    return {
      type: "thread.turn.queue",
      commandId: input.queuedMessage.commandId,
      threadId: input.queuedMessage.threadId,
      message,
      createdAt: input.queuedMessage.createdAt,
    };
  }

  return {
    type: "thread.turn.start",
    commandId: input.queuedMessage.commandId,
    threadId: input.queuedMessage.threadId,
    message,
    runtimeMode: input.thread.runtimeMode,
    interactionMode: input.thread.interactionMode,
    createdAt: input.queuedMessage.createdAt,
  };
}
