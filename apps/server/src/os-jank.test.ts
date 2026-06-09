import { describe, expect, it } from "@effect/vitest";

import { fixPath } from "./os-jank.ts";

describe("fixPath", () => {
  it("adds known macOS CLI directories when shell path probes are empty", () => {
    const env: NodeJS.ProcessEnv = {
      HOME: "/Users/test",
      PATH: "/usr/bin",
    };

    fixPath({
      env,
      platform: "darwin",
      readPath: () => undefined,
      readLaunchctlPath: () => undefined,
      userShell: "",
      logWarning: () => undefined,
    });

    expect(env.PATH).toBe(
      [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/Users/test/.local/bin",
        "/Users/test/.bun/bin",
        "/Users/test/.cargo/bin",
        "/Users/test/.volta/bin",
        "/Users/test/Library/pnpm",
        "/usr/bin",
      ].join(":"),
    );
  });
});
