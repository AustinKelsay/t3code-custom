import * as NodeAssert from "node:assert/strict";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { discoverLocalProviderSkills } from "./localSkillDiscovery.ts";

it.layer(NodeServices.layer)("local skill discovery", (it) => {
  it.effect("discovers local SKILL.md folders with non-empty descriptions", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectory({ prefix: "t3code-skills-" });
      const skillDir = path.join(root, "canvas");
      yield* fileSystem.makeDirectory(skillDir);
      yield* fileSystem.writeFileString(
        path.join(skillDir, "SKILL.md"),
        `---
name: canvas
description: ''
---
A canvas is a standalone artifact shown beside the chat.
`,
      );

      const skills = discoverLocalProviderSkills(root);

      NodeAssert.equal(skills.length, 1);
      NodeAssert.equal(skills[0]?.name, "canvas");
      NodeAssert.equal(skills[0]?.displayName, "Canvas");
      NodeAssert.equal(
        skills[0]?.description,
        "A canvas is a standalone artifact shown beside the chat.",
      );
      NodeAssert.equal(skills[0]?.shortDescription, skills[0]?.description);
    }),
  );
});
