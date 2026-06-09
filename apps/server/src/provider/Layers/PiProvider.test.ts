import { assert, it } from "@effect/vitest";
import { PiSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import { checkPiProviderStatus } from "./PiProvider.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);

function failingSpawnerLayer(description: string) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() =>
      Effect.fail(
        PlatformError.systemError({
          _tag: "NotFound",
          module: "ChildProcess",
          method: "spawn",
          description,
        }),
      ),
    ),
  );
}

const makePiSettings = (overrides?: Partial<PiSettings>): PiSettings =>
  decodePiSettings({
    enabled: true,
    binaryPath: "pi",
    ...overrides,
  });

it.effect("reports the Pi CLI as offline when the configured binary is missing", () =>
  Effect.gen(function* () {
    const snapshot = yield* checkPiProviderStatus(makePiSettings());

    assert.strictEqual(snapshot.status, "error");
    assert.strictEqual(snapshot.installed, false);
    assert.strictEqual(snapshot.auth.status, "unknown");
    assert.strictEqual(snapshot.version, null);
    assert.strictEqual(snapshot.message, "Pi CLI (`pi`) is not installed or not on PATH.");
  }).pipe(Effect.provide(failingSpawnerLayer("spawn pi ENOENT"))),
);
