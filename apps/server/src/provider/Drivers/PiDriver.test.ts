import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { PiSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
      sessionModelSwitch: "unsupported",
      turnSteering: "native",
    });
    assert.deepStrictEqual((yield* instance.snapshot.getSnapshot).capabilities, {
      turnSteering: "native",
    });
  }).pipe(Effect.provide(testLayer), Effect.scoped),
);
