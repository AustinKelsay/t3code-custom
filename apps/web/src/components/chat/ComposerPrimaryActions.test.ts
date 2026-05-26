import { describe, expect, it } from "vitest";

import {
  getRunningFollowUpAlternateAction,
  formatPendingPrimaryActionLabel,
  formatRunningFollowUpActionLabel,
} from "./ComposerPrimaryActions";

describe("formatPendingPrimaryActionLabel", () => {
  it("returns 'Submitting...' while responding", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: true,
        questionIndex: 0,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submitting...' while responding regardless of other flags", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: true,
        questionIndex: 3,
      }),
    ).toBe("Submitting...");
  });

  it("returns 'Submit' in compact mode on the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit");
  });

  it("returns 'Next' in compact mode when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: true,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Next");
  });

  it("returns 'Next question' when not the last question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: false,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Next question");
  });

  it("returns singular 'Submit answer' on the last question when it is the only question", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 0,
      }),
    ).toBe("Submit answer");
  });

  it("returns plural 'Submit answers' on the last question when there are multiple questions", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 1,
      }),
    ).toBe("Submit answers");
  });

  it("returns plural 'Submit answers' for higher question indices", () => {
    expect(
      formatPendingPrimaryActionLabel({
        compact: false,
        isLastQuestion: true,
        isResponding: false,
        questionIndex: 5,
      }),
    ).toBe("Submit answers");
  });
});

describe("formatRunningFollowUpActionLabel", () => {
  it("labels running follow-ups from the effective Queue or Steer behavior", () => {
    expect(formatRunningFollowUpActionLabel({ behavior: "queue", isBusy: false })).toBe("Queue");
    expect(formatRunningFollowUpActionLabel({ behavior: "steer", isBusy: false })).toBe("Steer");
  });

  it("keeps the busy label aligned with the effective behavior", () => {
    expect(formatRunningFollowUpActionLabel({ behavior: "queue", isBusy: true })).toBe(
      "Queueing...",
    );
    expect(formatRunningFollowUpActionLabel({ behavior: "steer", isBusy: true })).toBe(
      "Steering...",
    );
  });
});

describe("getRunningFollowUpAlternateAction", () => {
  it("offers the opposite one-shot running follow-up behavior", () => {
    expect(getRunningFollowUpAlternateAction("queue")).toEqual({
      behavior: "steer",
      label: "Steer this turn",
    });
    expect(getRunningFollowUpAlternateAction("steer")).toEqual({
      behavior: "queue",
      label: "Queue instead",
    });
  });
});
