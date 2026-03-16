import { describe, expect, it } from "vitest";

import {
  buildRemoteCodexProbeCommand,
  buildRemoteCodexResolveCommand,
  buildRemoteCodexShellCommand,
  resolveRemoteCodexLaunchOptions,
} from "./remoteCodex";

describe("remoteCodex", () => {
  it("builds a login-shell resolver with common codex fallbacks", () => {
    const command = buildRemoteCodexResolveCommand();

    expect(command).toContain('for candidate in "${SHELL:-}"');
    expect(command).toContain('output="$("$candidate" -ilc');
    expect(command).toContain('output="$("$candidate" -lc');
    expect(command).toContain("$HOME/.npm-global/bin/codex");
    expect(command).toContain("$HOME/.local/bin/codex");
    expect(command).toContain('printf "%s\\n" "$output"');
  });

  it("builds an executable probe for explicit binary paths", () => {
    expect(buildRemoteCodexProbeCommand("/opt/codex/bin/codex")).toBe(
      "[ -x '/opt/codex/bin/codex' ]",
    );
  });

  it("builds a shell launcher that probes login shells before exec", () => {
    const script = buildRemoteCodexShellCommand({
      binaryPath: "codex",
      cwd: "/remote/worktree",
      homePath: "/remote/.codex",
      args: ["app-server"],
    });

    expect(script).toContain('for candidate in "${SHELL:-}"');
    expect(script).toContain('if "$candidate" -ilc');
    expect(script).toContain('if "$candidate" -lc');
    expect(script).toContain("/remote/worktree");
    expect(script).toContain("CODEX_HOME");
    expect(script).toContain("app-server");
  });

  it("resolves an explicit remote codex path from ssh output", async () => {
    const result = await resolveRemoteCodexLaunchOptions({
      targetLabel: "clawd",
      connection: {
        host: "example.com",
        user: "deploy",
      },
      binaryPath: "/home/deploy/.npm-global/bin/codex",
      homePath: "/home/deploy/.codex",
      run: async () => ({
        code: 0,
        stdout: "/home/deploy/.npm-global/bin/codex\n",
        stderr: "",
        signal: null,
        timedOut: false,
      }),
    });

    expect(result).toEqual({
      binaryPath: "/home/deploy/.npm-global/bin/codex",
      homePath: "/home/deploy/.codex",
    });
  });

  it("surfaces a helpful error when codex cannot be resolved remotely", async () => {
    await expect(
      resolveRemoteCodexLaunchOptions({
        targetLabel: "clawd",
        connection: {
          host: "example.com",
        },
        run: async () => ({
          code: 1,
          stdout: "",
          stderr: "",
          signal: null,
          timedOut: false,
        }),
      }),
    ).rejects.toThrow(
      "Codex CLI could not be found on target 'clawd'. Install codex there or set the target's Codex binary path in Settings.",
    );
  });
});
