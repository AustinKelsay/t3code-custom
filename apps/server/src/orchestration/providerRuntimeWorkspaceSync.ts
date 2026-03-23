import type { GitBranch, ProviderRuntimeEvent, ProjectId } from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readCompletedCommandExecutionContext(
  event: ProviderRuntimeEvent,
): { command: string | null; cwd: string | null } | null {
  if (event.type !== "item.completed" || event.payload.itemType !== "command_execution") {
    return null;
  }

  const payload = asRecord(event.payload);
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item) ?? data;
  if (!item) {
    return null;
  }

  return {
    command: asTrimmedString(item.command),
    cwd: asTrimmedString(item.cwd),
  };
}

export function shouldAttemptWorkspaceReconciliation(input: {
  command: string | null;
  commandCwd: string;
  threadWorktreePath: string | null;
  projectWorkspaceRoot: string;
}): boolean {
  const currentWorkspaceCwd = input.threadWorktreePath ?? input.projectWorkspaceRoot;
  if (input.commandCwd !== currentWorkspaceCwd) {
    return true;
  }

  const command = input.command?.toLowerCase() ?? "";
  return /\bgit\s+(checkout|switch|worktree)\b/.test(command);
}

export function resolveThreadWorkspaceMetadataUpdate(input: {
  commandCwd: string;
  thread: {
    branch: string | null;
    worktreePath: string | null;
    projectId: ProjectId;
  };
  project: {
    id: ProjectId;
    workspaceRoot: string;
  };
  statusBranch: string | null;
  branches: ReadonlyArray<Pick<GitBranch, "isRemote" | "name" | "worktreePath">>;
}): { branch: string; worktreePath: string | null } | null {
  if (input.thread.projectId !== input.project.id || !input.statusBranch) {
    return null;
  }

  const matchingBranch = input.branches.find(
    (branch) =>
      !branch.isRemote &&
      branch.name === input.statusBranch &&
      branch.worktreePath === input.commandCwd,
  );
  const nextWorktreePath =
    input.commandCwd === input.project.workspaceRoot
      ? null
      : (matchingBranch?.worktreePath ?? null);

  if (input.commandCwd !== input.project.workspaceRoot && nextWorktreePath === null) {
    return null;
  }

  if (
    input.thread.branch === input.statusBranch &&
    input.thread.worktreePath === nextWorktreePath
  ) {
    return null;
  }

  return {
    branch: input.statusBranch,
    worktreePath: nextWorktreePath,
  };
}
