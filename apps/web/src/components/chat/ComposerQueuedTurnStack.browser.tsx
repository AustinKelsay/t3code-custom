import "../../index.css";

import { MessageId, TurnQueueItemId, type OrchestrationQueuedTurn } from "@t3tools/contracts";
import { page } from "vite-plus/test/browser";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createRoot } from "react-dom/client";

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

describe("ComposerQueuedTurnStack", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders a compact queue stack without transcript message roles", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    root.render(
      <ComposerQueuedTurnStack
        queuedTurns={[
          makeQueuedTurn({
            id: "queue-first",
            status: "pending",
            text: "First queued follow-up",
            createdAt: "2026-06-12T12:00:30.000Z",
          }),
          makeQueuedTurn({
            id: "queue-second",
            status: "sending",
            text: "Second queued follow-up",
            createdAt: "2026-06-12T12:00:00.000Z",
          }),
          makeQueuedTurn({
            id: "queue-third",
            status: "failed",
            text: "Retry this queued follow-up",
            createdAt: "2026-06-12T12:00:10.000Z",
          }),
        ]}
        onRemoveQueuedTurn={vi.fn()}
        onRetryQueuedTurn={vi.fn()}
      />,
    );
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    try {
      await expect.element(page.getByLabelText("3 queued messages")).toBeVisible();
      await expect.element(page.getByText("First queued follow-up")).toBeVisible();
      await expect.element(page.getByText("Second queued follow-up")).toBeVisible();
      await expect.element(page.getByText("Retry this queued follow-up")).toBeVisible();
      await expect.element(page.getByLabelText("Retry queued message 3")).toBeVisible();
      await expect.element(page.getByLabelText("Remove queued message 1")).toBeVisible();

      const stack = document.querySelector<HTMLElement>("[data-queued-turn-stack]");
      expect(stack?.textContent).toContain("Queued");
      expect(stack?.textContent).toContain("Sending");
      expect(stack?.textContent).toContain("Failed");
      const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-queued-turn-item]"));
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.dataset.queuedTurnPosition)).toEqual(["1", "2", "3"]);
      expect(rows.map((row) => row.dataset.queuedTurnStatus)).toEqual([
        "pending",
        "sending",
        "failed",
      ]);
      expect(document.querySelector('[data-message-role="user"]')).toBeNull();
      for (const row of rows) {
        expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(44);
      }
    } finally {
      root.unmount();
      container.remove();
    }
  });
});
