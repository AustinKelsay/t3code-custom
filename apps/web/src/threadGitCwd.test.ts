import { describe, expect, it } from "vitest";

import { resolveThreadGitCwd } from "./threadGitCwd";

describe("resolveThreadGitCwd", () => {
  it("prefers the thread worktree path when present", () => {
    expect(
      resolveThreadGitCwd({
        thread: {
          branch: "feature/demo",
          worktreePath: "/repo/.t3/worktrees/feature-demo",
        },
        project: {
          cwd: "/repo",
        },
        branches: [],
      }),
    ).toBe("/repo/.t3/worktrees/feature-demo");
  });

  it("falls back to the branch worktree path when thread metadata is stale", () => {
    expect(
      resolveThreadGitCwd({
        thread: {
          branch: "feature/demo",
          worktreePath: null,
        },
        project: {
          cwd: "/repo",
        },
        branches: [
          {
            name: "feature/demo",
            isRemote: false,
            worktreePath: "/Users/nick/code/feature-demo",
          },
        ],
      }),
    ).toBe("/Users/nick/code/feature-demo");
  });

  it("falls back to the project cwd when there is no worktree mapping", () => {
    expect(
      resolveThreadGitCwd({
        thread: {
          branch: "main",
          worktreePath: null,
        },
        project: {
          cwd: "/repo",
        },
        branches: [
          {
            name: "main",
            isRemote: false,
            worktreePath: null,
          },
        ],
      }),
    ).toBe("/repo");
  });
});
