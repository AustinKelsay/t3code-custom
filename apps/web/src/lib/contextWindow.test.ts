import { describe, expect, it } from "vitest";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import { deriveLatestContextWindowSnapshot, formatContextWindowTokens } from "./contextWindow";

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

describe("contextWindow", () => {
  it("derives the latest valid context window snapshot", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 1000,
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 14_000,
        maxTokens: 258_000,
        compactsAutomatically: true,
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(14_000);
    expect(snapshot?.totalProcessedTokens).toBeNull();
    expect(snapshot?.maxTokens).toBe(258_000);
    expect(snapshot?.compactsAutomatically).toBe(true);
    expect(snapshot?.source).toBe("live");
  });

  it("ignores malformed payloads", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {}),
    ]);

    expect(snapshot).toBeNull();
  });

  it("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1400)).toBe("1.4k");
    expect(formatContextWindowTokens(14_000)).toBe("14k");
    expect(formatContextWindowTokens(258_000)).toBe("258k");
  });

  it("includes total processed tokens when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
        maxTokens: 258_400,
        lastUsedTokens: 81_659,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(81_659);
    expect(snapshot?.totalProcessedTokens).toBe(748_126);
  });

  it("synthesizes an estimated snapshot when no live activity exists and fallback is valid", () => {
    const snapshot = deriveLatestContextWindowSnapshot(
      [makeActivity("activity-1", "tool.started", {})],
      { maxTokens: 200_000, usedTokens: 50_000 },
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(50_000);
    expect(snapshot?.maxTokens).toBe(200_000);
    expect(snapshot?.compactsAutomatically).toBe(true);
    expect(snapshot?.source).toBe("estimated");
    expect(snapshot?.usedPercentage).toBe(25);
    expect(snapshot?.remainingTokens).toBe(150_000);
    expect(snapshot?.remainingPercentage).toBe(75);
    expect(snapshot?.totalProcessedTokens).toBeNull();
  });

  it("prefers live data over fallback when both are present", () => {
    const snapshot = deriveLatestContextWindowSnapshot(
      [
        makeActivity("activity-1", "context-window.updated", {
          usedTokens: 10_000,
          maxTokens: 100_000,
        }),
      ],
      { maxTokens: 200_000, usedTokens: 50_000 },
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(10_000);
    expect(snapshot?.maxTokens).toBe(100_000);
    expect(snapshot?.source).toBe("live");
  });

  it("returns null when no live activity exists and fallback is missing", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "tool.started", {}),
    ]);

    expect(snapshot).toBeNull();
  });

  it("returns null when fallback has zero maxTokens", () => {
    const snapshot = deriveLatestContextWindowSnapshot(
      [makeActivity("activity-1", "tool.started", {})],
      { maxTokens: 0, usedTokens: 50_000 },
    );

    expect(snapshot).toBeNull();
  });

  it("returns null when fallback has zero usedTokens", () => {
    const snapshot = deriveLatestContextWindowSnapshot(
      [makeActivity("activity-1", "tool.started", {})],
      { maxTokens: 200_000, usedTokens: 0 },
    );

    expect(snapshot).toBeNull();
  });
});
