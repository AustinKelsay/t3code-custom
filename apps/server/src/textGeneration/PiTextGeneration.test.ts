import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { PiSettings, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { expect } from "vite-plus/test";

import { type TextGenerationShape } from "./TextGeneration.ts";
import { makePiTextGeneration } from "./PiTextGeneration.ts";

const decodePiSettings = Schema.decodeSync(PiSettings);
const DEFAULT_TEST_MODEL_SELECTION = createModelSelection(
  ProviderInstanceId.make("pi"),
  "spark-ingress/alpha",
);

function makeFakePiBinary(
  dir: string,
  input: {
    readonly output: string;
    readonly exitCode?: number | undefined;
    readonly stderr?: string | undefined;
    readonly stdinMustContain?: string | undefined;
  },
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = path.join(dir, "bin");
    const piPath = path.join(binDir, "pi");
    yield* fs.makeDirectory(binDir, { recursive: true });
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
        'if [ "$seen_print" != "1" ]; then',
        '  printf "%s\\n" "missing --print" >&2',
        "  exit 2",
        "fi",
        'if [ "$seen_no_session" != "1" ]; then',
        '  printf "%s\\n" "missing --no-session" >&2',
        "  exit 3",
        "fi",
        'if [ "$seen_model" != "spark-ingress/alpha" ]; then',
        '  printf "%s\\n" "unexpected model: $seen_model" >&2',
        "  exit 4",
        "fi",
        ...(input.stdinMustContain !== undefined
          ? [
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              `if ! printf "%s" "$stdin_content" | grep -F -- ${JSON.stringify(input.stdinMustContain)} >/dev/null; then`,
              '  printf "%s\\n" "stdin missing expected content" >&2',
              "  exit 5",
              "fi",
            ]
          : []),
        ...(input.stderr !== undefined
          ? [
              // @effect-diagnostics-next-line preferSchemaOverJson:off
              `printf "%s\\n" ${JSON.stringify(input.stderr)} >&2`,
            ]
          : []),
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        `printf "%s\\n" ${JSON.stringify(input.output)}`,
        `exit ${input.exitCode ?? 0}`,
        "",
      ].join("\n"),
    );
    yield* fs.chmod(piPath, 0o755);
    return piPath;
  });
}

function withFakePiTextGeneration<A, E, R>(
  input: {
    readonly output: string;
    readonly exitCode?: number | undefined;
    readonly stderr?: string | undefined;
    readonly stdinMustContain?: string | undefined;
  },
  effectFn: (textGeneration: TextGenerationShape) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-pi-text-" });
    const piPath = yield* makeFakePiBinary(tempDir, input);
    const textGeneration = yield* makePiTextGeneration(decodePiSettings({ binaryPath: piPath }));
    return yield* effectFn(textGeneration);
  }).pipe(Effect.scoped);
}

it.layer(NodeServices.layer)("PiTextGeneration", (it) => {
  it.effect("generates and sanitizes commit messages with Pi print mode", () =>
    withFakePiTextGeneration(
      {
        output:
          'Sure:\n{"subject":"  Add Pi generated commit title with far too much detail and trailing punctuation.\\nignored","body":"\\n- wired pi\\n"}',
        stdinMustContain: "Return a JSON object with keys: subject, body.",
      },
      (textGeneration) =>
        Effect.gen(function* () {
          const generated = yield* textGeneration.generateCommitMessage({
            cwd: process.cwd(),
            branch: "feature/pi-text",
            stagedSummary: "M apps/server/src/provider/Drivers/PiDriver.ts",
            stagedPatch: "diff --git a/apps/server/src/provider/Drivers/PiDriver.ts",
            modelSelection: DEFAULT_TEST_MODEL_SELECTION,
          });

          expect(generated.subject.length).toBeLessThanOrEqual(72);
          expect(generated.subject.endsWith(".")).toBe(false);
          expect(generated.body).toBe("- wired pi");
          expect(generated.branch).toBeUndefined();
        }),
    ),
  );
});
