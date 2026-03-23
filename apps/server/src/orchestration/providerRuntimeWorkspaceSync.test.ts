import { describe, expect, it } from "vitest";
import { EventId, ThreadId } from "@t3tools/contracts";

import {
  readCompletedCommandExecutionContext,
  resolveThreadWorkspaceMetadataUpdate,
  shouldAttemptWorkspaceReconciliation,
} from "./providerRuntimeWorkspaceSync.ts";

describe("providerRuntimeWorkspaceSync", () => {
  it("reads cwd and command from completed command execution events", () => {
    expect(
      readCompletedCommandExecutionContext({
        type: "item.completed",
        eventId: EventId.makeUnsafe("event-1"),
        provider: "codex",
        threadId: ThreadId.makeUnsafe("thread-1"),
        createdAt: "2026-03-19T00:00:00.000Z",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: "git status",
              cwd: "/repo/worktree",
            },
          },
        },
      } as const),
    ).toEqual({
      command: "git status",
      cwd: "/repo/worktree",
    });
  });

  it("ignores non-command lifecycle events", () => {
    expect(
      readCompletedCommandExecutionContext({
        type: "item.started",
        eventId: EventId.makeUnsafe("event-1"),
        provider: "codex",
        threadId: ThreadId.makeUnsafe("thread-1"),
        createdAt: "2026-03-19T00:00:00.000Z",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: "git status",
              cwd: "/repo/worktree",
            },
          },
        },
      } as const),
    ).toBeNull();
  });

  it("reconciles when commands complete in a different cwd", () => {
    expect(
      shouldAttemptWorkspaceReconciliation({
        command: "sed -n '1,20p' file.ts",
        commandCwd: "/repo/worktree",
        threadWorktreePath: null,
        projectWorkspaceRoot: "/repo",
      }),
    ).toBe(true);
  });

  it("reconciles git checkout operations in the current cwd", () => {
    expect(
      shouldAttemptWorkspaceReconciliation({
        command: "git switch feature/passkeys",
        commandCwd: "/repo",
        threadWorktreePath: null,
        projectWorkspaceRoot: "/repo",
      }),
    ).toBe(true);
  });

  it("skips unrelated commands in the current cwd", () => {
    expect(
      shouldAttemptWorkspaceReconciliation({
        command: "rg passkey src",
        commandCwd: "/repo",
        threadWorktreePath: null,
        projectWorkspaceRoot: "/repo",
      }),
    ).toBe(false);
  });

  it("maps known worktree branches back onto thread metadata", () => {
    expect(
      resolveThreadWorkspaceMetadataUpdate({
        commandCwd: "/repo/lni-spark-passkey",
        thread: {
          branch: "codex/mpp-traits-scaffold",
          worktreePath: "/repo/lni-mpp-traits",
          projectId: "project-1" as never,
        },
        project: {
          id: "project-1" as never,
          workspaceRoot: "/repo/lni",
        },
        statusBranch: "lni-spark-passkey",
        branches: [
          {
            isRemote: false,
            name: "lni-spark-passkey",
            worktreePath: "/repo/lni-spark-passkey",
          },
        ],
      }),
    ).toEqual({
      branch: "lni-spark-passkey",
      worktreePath: "/repo/lni-spark-passkey",
    });
  });

  it("normalizes the project root to local mode", () => {
    expect(
      resolveThreadWorkspaceMetadataUpdate({
        commandCwd: "/repo/lni",
        thread: {
          branch: "feature/worktree",
          worktreePath: "/repo/lni-worktree",
          projectId: "project-1" as never,
        },
        project: {
          id: "project-1" as never,
          workspaceRoot: "/repo/lni",
        },
        statusBranch: "master",
        branches: [
          {
            isRemote: false,
            name: "master",
            worktreePath: "/repo/lni",
          },
        ],
      }),
    ).toEqual({
      branch: "master",
      worktreePath: null,
    });
  });

  it("ignores unknown sibling directories that are not tracked worktrees", () => {
    expect(
      resolveThreadWorkspaceMetadataUpdate({
        commandCwd: "/repo/random-dir",
        thread: {
          branch: "master",
          worktreePath: null,
          projectId: "project-1" as never,
        },
        project: {
          id: "project-1" as never,
          workspaceRoot: "/repo/lni",
        },
        statusBranch: "master",
        branches: [
          {
            isRemote: false,
            name: "master",
            worktreePath: "/repo/lni",
          },
        ],
      }),
    ).toBeNull();
  });
});
