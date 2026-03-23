import type { GitBranch } from "@t3tools/contracts";

export function resolveThreadGitCwd(input: {
  thread:
    | {
        branch: string | null;
        worktreePath: string | null;
      }
    | null
    | undefined;
  project:
    | {
        cwd: string;
      }
    | null
    | undefined;
  branches?:
    | ReadonlyArray<Pick<GitBranch, "isRemote" | "name" | "worktreePath">>
    | null
    | undefined;
}): string | null {
  if (input.thread?.worktreePath) {
    return input.thread.worktreePath;
  }

  const projectCwd = input.project?.cwd ?? null;
  if (!projectCwd) {
    return null;
  }

  const threadBranch = input.thread?.branch ?? null;
  if (!threadBranch || !input.branches) {
    return projectCwd;
  }

  const matchingBranch = input.branches.find(
    (branch) => !branch.isRemote && branch.name === threadBranch,
  );

  return matchingBranch?.worktreePath ?? projectCwd;
}
