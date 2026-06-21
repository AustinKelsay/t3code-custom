import { MessageId, TurnQueueItemId, type OrchestrationQueuedTurn } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { ComposerQueuedTurnStack } from "./ComposerQueuedTurnStack";

function makeQueuedTurn(input: {
  id: string;
  status: OrchestrationQueuedTurn["status"];
  text: string;
  createdAt?: string;
}): OrchestrationQueuedTurn {
  const createdAt = input.createdAt ?? "2026-06-12T12:00:00.000Z";
  return {
    queueItemId: TurnQueueItemId.make(input.id),
    status: input.status,
    request: {
      message: {
        messageId: MessageId.make(`message-${input.id}`),
        role: "user",
        text: input.text,
        attachments: [],
      },
    },
    failureReason: input.status === "failed" ? "Provider rejected queued turn." : null,
    createdAt,
    updatedAt: createdAt,
  };
}

function renderStack(queuedTurns: ReadonlyArray<OrchestrationQueuedTurn>) {
  return renderToStaticMarkup(
    <ComposerQueuedTurnStack
      queuedTurns={queuedTurns}
      onRemoveQueuedTurn={vi.fn()}
      onRetryQueuedTurn={vi.fn()}
    />,
  );
}

describe("ComposerQueuedTurnStack", () => {
  it("renders nothing when there are no queued turns", () => {
    expect(renderStack([])).toBe("");
  });

  it("stacks queued turns directly in queue order", () => {
    const markup = renderStack([
      makeQueuedTurn({
        id: "queue-second-created",
        status: "pending",
        text: "First in queue order",
        createdAt: "2026-06-12T12:00:30.000Z",
      }),
      makeQueuedTurn({
        id: "queue-first-created",
        status: "pending",
        text: "Second in queue order",
        createdAt: "2026-06-12T12:00:00.000Z",
      }),
    ]);

    expect(markup).toContain('data-queued-turn-stack="true"');
    expect(markup).toContain('data-queued-turn-outbox="true"');
    expect(markup).toContain('data-queued-turn-position="1"');
    expect(markup).toContain('data-queued-turn-position="2"');
    expect(markup.indexOf("First in queue order")).toBeLessThan(
      markup.indexOf("Second in queue order"),
    );
  });

  it("renders queued turns as an unsent outbox with queue actions", () => {
    const markup = renderStack([
      makeQueuedTurn({ id: "queue-pending", status: "pending", text: "Queued follow-up" }),
      makeQueuedTurn({ id: "queue-sending", status: "sending", text: "Currently sending" }),
      makeQueuedTurn({ id: "queue-failed", status: "failed", text: "Needs retry" }),
    ]);

    expect(markup).toContain('aria-label="Outbox, 3 queued messages waiting to send"');
    expect(markup).toContain("Outbox");
    expect(markup).toContain("3 waiting to send");
    expect(markup).toContain('aria-label="Queued message 1, queued in outbox, not sent yet"');
    expect(markup).toContain('data-queued-turn-status="pending"');
    expect(markup).toContain("Queued, not sent yet");
    expect(markup).toContain("Queued follow-up");
    expect(markup).toContain('aria-label="Queued message 2, sending from outbox"');
    expect(markup).toContain('data-queued-turn-status="sending"');
    expect(markup).toContain("Currently sending");
    expect(markup).toContain('aria-label="Queued message 3, failed before sending"');
    expect(markup).toContain('data-queued-turn-status="failed"');
    expect(markup).toContain("Needs retry");
    expect(markup).not.toContain('data-message-role="user"');
    expect(markup).toContain('aria-label="Remove queued message 1"');
    expect(markup).toContain('aria-label="Remove queued message 2"');
    expect(markup).toContain('aria-label="Retry queued message 3"');
    expect(markup).toContain('aria-label="Remove queued message 3"');
  });
});
