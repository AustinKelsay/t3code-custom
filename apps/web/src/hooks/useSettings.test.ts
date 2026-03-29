import { describe, expect, it } from "vitest";
import {
  buildLegacyClientSettingsMigrationPatch,
  buildLegacyServerSettingsMigrationPatch,
} from "./useSettings";

describe("buildLegacyClientSettingsMigrationPatch", () => {
  it("migrates archive confirmation from legacy local settings", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        confirmThreadArchive: true,
        confirmThreadDelete: false,
      }),
    ).toEqual({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
    });
  });

  it("keeps local-only presentation settings on the client patch", () => {
    expect(
      buildLegacyClientSettingsMigrationPatch({
        timestampFormat: "24-hour",
        diffWordWrap: true,
        sidebarProjectSortOrder: "manual",
        sidebarThreadSortOrder: "updated_at",
      }),
    ).toEqual({
      timestampFormat: "24-hour",
      diffWordWrap: true,
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "updated_at",
    });
  });
});

describe("buildLegacyServerSettingsMigrationPatch", () => {
  it("moves runtime-affecting settings into the server patch", () => {
    expect(
      buildLegacyServerSettingsMigrationPatch({
        enableAssistantStreaming: true,
        defaultThreadEnvMode: "worktree",
        codexBinaryPath: "/usr/local/bin/codex",
        codexHomePath: "/tmp/codex-home",
        claudeBinaryPath: "/usr/local/bin/claude",
        customCodexModels: [" custom/codex-model "],
        customClaudeModels: ["claude/custom-opus"],
        textGenerationModel: "claude-sonnet-4-6",
      }),
    ).toEqual({
      enableAssistantStreaming: true,
      defaultThreadEnvMode: "worktree",
      providers: {
        codex: {
          binaryPath: "/usr/local/bin/codex",
          homePath: "/tmp/codex-home",
          customModels: ["custom/codex-model"],
        },
        claudeAgent: {
          binaryPath: "/usr/local/bin/claude",
          customModels: ["claude/custom-opus"],
        },
      },
      textGenerationModelSelection: {
        provider: "claudeAgent",
        model: "claude-sonnet-4-6",
      },
    });
  });

  it("ignores malformed or empty legacy values", () => {
    expect(
      buildLegacyServerSettingsMigrationPatch({
        enableAssistantStreaming: "yes",
        defaultThreadEnvMode: "bogus",
        textGenerationModel: "   ",
        customCodexModels: ["gpt-5.4", ""],
      }),
    ).toEqual({
      providers: {
        codex: {
          customModels: [],
        },
      },
    });
  });
});
