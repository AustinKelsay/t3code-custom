import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { PiSettings, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { PiDriver } from "./PiDriver.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);

const TestHttpClientLive = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ version: "0.0.0" }))),
  ),
);

const testLayer = Layer.mergeAll(NodeServices.layer, TestHttpClientLive);

const makePiSettings = (overrides?: Partial<PiSettings>): PiSettings =>
  decodePiSettings({
    enabled: true,
    binaryPath: "pi",
    ...overrides,
  });

const makeFakePiBinary = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-pi-driver-" });
  const piPath = path.join(tempDir, "pi");
  yield* fs.writeFileString(
    piPath,
    [
      "#!/bin/sh",
      'seen_print="0"',
      'seen_no_session="0"',
      'seen_model=""',
      "while [ $# -gt 0 ]; do",
      '  if [ "$1" = "--print" ]; then',
      '    seen_print="1"',
      "    shift",
      "    continue",
      "  fi",
      '  if [ "$1" = "--no-session" ]; then',
      '    seen_no_session="1"',
      "    shift",
      "    continue",
      "  fi",
      '  if [ "$1" = "--model" ]; then',
      "    shift",
      '    seen_model="$1"',
      "    shift",
      "    continue",
      "  fi",
      "  shift",
      "done",
      'stdin_content="$(cat)"',
      'if [ "$seen_print" != "1" ] || [ "$seen_no_session" != "1" ]; then',
      '  printf "%s\\n" "missing pi text generation flags" >&2',
      "  exit 2",
      "fi",
      'if [ "$seen_model" != "spark-ingress/alpha" ]; then',
      '  printf "%s\\n" "unexpected model: $seen_model" >&2',
      "  exit 3",
      "fi",
      'if ! printf "%s" "$stdin_content" | grep -F -- "Return a JSON object with key: title." >/dev/null; then',
      '  printf "%s\\n" "stdin missing title prompt" >&2',
      "  exit 4",
      "fi",
      'printf "%s\\n" "{\\"title\\":\\"Pi driver title\\"}"',
      "exit 0",
      "",
    ].join("\n"),
  );
  yield* fs.chmod(piPath, 0o755);
  return piPath;
});

it.effect("exposes package-managed Pi maintenance capabilities", () =>
  Effect.gen(function* () {
    const instance = yield* PiDriver.create({
      instanceId: ProviderInstanceId.make("pi_default"),
      displayName: "Pi",
      environment: [],
      enabled: false,
      config: makePiSettings({
        binaryPath: "definitely_missing_pi_cli_for_t3code_tests",
      }),
    });

    assert.strictEqual(
      instance.snapshot.maintenanceCapabilities.packageName,
      "@earendil-works/pi-coding-agent",
    );
    assert.deepStrictEqual(instance.snapshot.maintenanceCapabilities.update, {
      command: "npm install -g @earendil-works/pi-coding-agent@latest",
      executable: "npm",
      args: ["install", "-g", "@earendil-works/pi-coding-agent@latest"],
      lockKey: "npm-global",
    });
    assert.deepStrictEqual(instance.adapter.capabilities, {
      sessionModelSwitch: "in-session",
      turnSteering: "native",
    });
    assert.deepStrictEqual((yield* instance.snapshot.getSnapshot).capabilities, {
      turnSteering: "native",
    });
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);

it.effect("wires Pi text generation through provider instances", () =>
  Effect.gen(function* () {
    const instanceId = ProviderInstanceId.make("pi_default");
    const piPath = yield* makeFakePiBinary;
    const instance = yield* PiDriver.create({
      instanceId,
      displayName: "Pi",
      environment: [],
      enabled: true,
      config: makePiSettings({
        binaryPath: piPath,
      }),
    });

    const generated = yield* instance.textGeneration.generateThreadTitle({
      cwd: process.cwd(),
      message: "Please add Pi text generation",
      modelSelection: createModelSelection(instanceId, "spark-ingress/alpha"),
    });

    assert.deepStrictEqual(generated, { title: "Pi driver title" });
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);
