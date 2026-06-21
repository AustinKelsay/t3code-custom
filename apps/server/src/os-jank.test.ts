import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";

import { fixPath } from "./os-jank.ts";

describe("fixPath", () => {
  it.effect("adds known macOS CLI directories to the host PATH", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = {
        HOME: "/Users/test",
        PATH: "/usr/bin",
      };

      yield* fixPath().pipe(
        Effect.provideService(HostProcessPlatform, "darwin"),
        Effect.provideService(HostProcessEnvironment, env),
        Effect.provide(NodeServices.layer),
      );

      const pathEntries = env.PATH?.split(":") ?? [];
      for (const entry of [
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
      ]) {
        expect(pathEntries).toContain(entry);
      }
    }),
  );
});
