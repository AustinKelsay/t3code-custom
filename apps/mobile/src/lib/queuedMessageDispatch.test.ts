import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentScopedThreadShell } from "@t3tools/client-runtime";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

import { buildQueuedMessageDispatchCommand } from "./queuedMessageDispatch";
import type { QueuedThreadMessage } from "./threadActivity";

const now = "2026-04-01T00:00:00.000Z";

function makeThread(
  input: Partial<EnvironmentScopedThreadShell> &
    Pick<EnvironmentScopedThreadShell, "environmentId" | "id">,
): EnvironmentScopedThreadShell {
  return {
    projectId: ProjectId.make("project-1"),
    title: "Mobile thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...input,
  };
}

function makeQueuedMessage(
  input: Partial<QueuedThreadMessage> & Pick<QueuedThreadMessage, "environmentId" | "threadId">,
): QueuedThreadMessage {
  return {
    messageId: MessageId.make("message-queued"),
    commandId: CommandId.make("command-queued"),
    text: "queued follow up",
    attachments: [],
    createdAt: now,
    ...input,
  };
}

describe("buildQueuedMessageDispatchCommand", () => {
  it("hands active thread sends to the server durable queue", () => {
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-1");
    const command = buildQueuedMessageDispatchCommand({
      queuedMessage: makeQueuedMessage({ environmentId, threadId }),
      thread: makeThread({
        environmentId,
        id: threadId,
        session: {
          threadId,
          status: "running",
          providerName: "Codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          runtimeMode: "full-access",
          activeTurnId: TurnId.make("turn-1"),
          lastError: null,
          updatedAt: now,
        },
      }),
    });

    expect(command).toMatchObject({
      type: "thread.turn.queue",
      threadId,
      message: {
        messageId: "message-queued",
        text: "queued follow up",
      },
    });
  });

  it("starts a normal turn when the target thread is idle", () => {
    const environmentId = EnvironmentId.make("env-1");
    const threadId = ThreadId.make("thread-1");
    const command = buildQueuedMessageDispatchCommand({
      queuedMessage: makeQueuedMessage({ environmentId, threadId }),
      thread: makeThread({ environmentId, id: threadId }),
    });

    expect(command).toMatchObject({
      type: "thread.turn.start",
      threadId,
      runtimeMode: "full-access",
      interactionMode: "default",
    });
  });
});
