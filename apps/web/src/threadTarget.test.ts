import { describe, expect, it } from "vitest";

import { resolveThreadTargetId } from "./threadTarget";

describe("resolveThreadTargetId", () => {
  it("prefers the active session target over the stored thread target", () => {
    expect(
      resolveThreadTargetId({
        thread: {
          targetId: "local",
          session: {
            targetId: "remote-dev",
          },
        },
      }),
    ).toBe("remote-dev");
  });

  it("falls back to the project target when the thread target is missing", () => {
    expect(
      resolveThreadTargetId({
        projectTargetId: "remote-dev",
      }),
    ).toBe("remote-dev");
  });

  it("falls back to local when neither thread nor project target is available", () => {
    expect(
      resolveThreadTargetId({
        thread: null,
      }),
    ).toBe("local");
  });
});
