import { describe, expect, it } from "vitest";

import { shouldShowNoCompletedTurnsState } from "./diffViewState";

describe("shouldShowNoCompletedTurnsState", () => {
  it("shows the empty completed-turns state when no turn diffs exist and uncommitted is not selected", () => {
    expect(
      shouldShowNoCompletedTurnsState({
        isUncommittedSelection: false,
        orderedTurnCount: 0,
      }),
    ).toBe(true);
  });

  it("allows uncommitted diff rendering even when there are no completed turn summaries", () => {
    expect(
      shouldShowNoCompletedTurnsState({
        isUncommittedSelection: true,
        orderedTurnCount: 0,
      }),
    ).toBe(false);
  });

  it("does not show the empty state when completed turn summaries exist", () => {
    expect(
      shouldShowNoCompletedTurnsState({
        isUncommittedSelection: false,
        orderedTurnCount: 2,
      }),
    ).toBe(false);
  });
});
