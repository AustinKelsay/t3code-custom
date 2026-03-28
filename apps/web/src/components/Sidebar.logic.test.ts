import { LOCAL_EXECUTION_TARGET_ID } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import type { Project, Thread } from "../types";

import {
  filterSidebarProjects,
  getVisibleThreadsForProject,
  hasUnseenCompletion,
  resolveProjectStatusIndicator,
  resolveSidebarNewThreadEnvMode,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  shouldClearThreadSelectionOnMouseDown,
} from "./Sidebar.logic";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1" as never,
    name: "Alpha Project",
    cwd: "/tmp/project",
    targetId: LOCAL_EXECUTION_TARGET_ID,
    model: "gpt-5",
    color: null,
    expanded: true,
    scripts: [],
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thread-1" as never,
    codexThreadId: null,
    projectId: "project-1" as never,
    targetId: LOCAL_EXECUTION_TARGET_ID,
    title: "Fix auth bug",
    model: "gpt-5",
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    archivedAt: null,
    pinnedAt: null,
    sortOrder: 1,
    createdAt: "2026-03-09T10:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeLatestTurn(overrides?: {
  completedAt?: string | null;
  startedAt?: string | null;
}): Parameters<typeof hasUnseenCompletion>[0]["latestTurn"] {
  return {
    turnId: "turn-1" as never,
    state: "completed",
    assistantMessageId: null,
    requestedAt: "2026-03-09T10:00:00.000Z",
    startedAt: overrides?.startedAt ?? "2026-03-09T10:00:00.000Z",
    completedAt: overrides?.completedAt ?? "2026-03-09T10:05:00.000Z",
  };
}

describe("hasUnseenCompletion", () => {
  it("returns true when a thread completed after its last visit", () => {
    expect(
      hasUnseenCompletion({
        interactionMode: "default",
        latestTurn: makeLatestTurn(),
        lastVisitedAt: "2026-03-09T10:04:00.000Z",
        proposedPlans: [],
        session: null,
      }),
    ).toBe(true);
  });
});

describe("shouldClearThreadSelectionOnMouseDown", () => {
  it("preserves selection for thread items", () => {
    const child = {
      closest: (selector: string) =>
        selector.includes("[data-thread-item]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(child)).toBe(false);
  });

  it("preserves selection for thread list toggle controls", () => {
    const selectionSafe = {
      closest: (selector: string) =>
        selector.includes("[data-thread-selection-safe]") ? ({} as Element) : null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(selectionSafe)).toBe(false);
  });

  it("clears selection for unrelated sidebar clicks", () => {
    const unrelated = {
      closest: () => null,
    } as unknown as HTMLElement;

    expect(shouldClearThreadSelectionOnMouseDown(unrelated)).toBe(true);
  });
});

describe("resolveSidebarNewThreadEnvMode", () => {
  it("uses the app default when the caller does not request a specific mode", () => {
    expect(
      resolveSidebarNewThreadEnvMode({
        defaultEnvMode: "worktree",
      }),
    ).toBe("worktree");
  });

  it("preserves an explicit requested mode over the app default", () => {
    expect(
      resolveSidebarNewThreadEnvMode({
        requestedEnvMode: "local",
        defaultEnvMode: "worktree",
      }),
    ).toBe("local");
  });
});

describe("filterSidebarProjects", () => {
  it("returns all projects and their threads when the filter is empty", () => {
    const project = makeProject();
    const thread = makeThread();

    expect(
      filterSidebarProjects({
        projects: [project],
        threads: [thread],
        filterText: "   ",
      }),
    ).toEqual([{ project, threads: [thread], projectMatched: false }]);
  });

  it("matches a project name and keeps all of its threads", () => {
    const project = makeProject({ name: "Payments API" });
    const threads = [
      makeThread({ id: "thread-1" as never, title: "Investigate retry bug" }),
      makeThread({ id: "thread-2" as never, title: "Refactor webhooks" }),
    ];

    expect(
      filterSidebarProjects({
        projects: [project],
        threads,
        filterText: "payments",
      }),
    ).toEqual([{ project, threads, projectMatched: true }]);
  });

  it("matches thread titles and narrows a project to only those threads", () => {
    const project = makeProject();
    const matchingThread = makeThread({ id: "thread-1" as never, title: "Fix auth bug" });
    const otherThread = makeThread({ id: "thread-2" as never, title: "Update docs" });

    expect(
      filterSidebarProjects({
        projects: [project],
        threads: [matchingThread, otherThread],
        filterText: "auth",
      }),
    ).toEqual([{ project, threads: [matchingThread], projectMatched: false }]);
  });

  it("omits projects with no matching project name or thread title", () => {
    expect(
      filterSidebarProjects({
        projects: [makeProject()],
        threads: [makeThread()],
        filterText: "does-not-exist",
      }),
    ).toEqual([]);
  });
});

describe("getVisibleThreadsForProject", () => {
  it("returns all threads when the list is expanded", () => {
    const threads = [
      makeThread({ id: "thread-1" as never }),
      makeThread({ id: "thread-2" as never }),
    ];

    expect(
      getVisibleThreadsForProject({
        threads,
        activeThreadId: "thread-2" as never,
        isThreadListExpanded: true,
        previewLimit: 1,
      }),
    ).toEqual({
      hasHiddenThreads: true,
      visibleThreads: threads,
    });
  });

  it("keeps the active thread visible when it falls outside the preview slice", () => {
    const threads = [
      makeThread({ id: "thread-1" as never }),
      makeThread({ id: "thread-2" as never }),
      makeThread({ id: "thread-3" as never }),
    ];

    expect(
      getVisibleThreadsForProject({
        threads,
        activeThreadId: "thread-3" as never,
        isThreadListExpanded: false,
        previewLimit: 2,
      }),
    ).toEqual({
      hasHiddenThreads: true,
      visibleThreads: [threads[0]!, threads[1]!, threads[2]!],
    });
  });

  it("falls back to the preview slice when the active thread is absent", () => {
    const threads = [
      makeThread({ id: "thread-1" as never }),
      makeThread({ id: "thread-2" as never }),
      makeThread({ id: "thread-3" as never }),
    ];

    expect(
      getVisibleThreadsForProject({
        threads,
        activeThreadId: "missing" as never,
        isThreadListExpanded: false,
        previewLimit: 2,
      }),
    ).toEqual({
      hasHiddenThreads: true,
      visibleThreads: [threads[0]!, threads[1]!],
    });
  });
});

describe("resolveThreadStatusPill", () => {
  const baseThread = {
    interactionMode: "plan" as const,
    latestTurn: null,
    lastVisitedAt: undefined,
    proposedPlans: [],
    session: {
      targetId: LOCAL_EXECUTION_TARGET_ID,
      provider: "codex" as const,
      status: "running" as const,
      createdAt: "2026-03-09T10:00:00.000Z",
      updatedAt: "2026-03-09T10:00:00.000Z",
      orchestrationStatus: "running" as const,
    },
  };

  it("shows pending approval before all other statuses", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Pending Approval", pulse: false });
  });

  it("shows awaiting input when plan mode is blocked on user answers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: true,
      }),
    ).toMatchObject({ label: "Awaiting Input", pulse: false });
  });

  it("falls back to working when the thread is actively running without blockers", () => {
    expect(
      resolveThreadStatusPill({
        thread: baseThread,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Working", pulse: true });
  });

  it("shows plan ready when a settled plan turn has a proposed plan ready for follow-up", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
              implementedAt: null,
              implementationThreadId: null,
            },
          ],
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Plan Ready", pulse: false });
  });

  it("does not show plan ready after the proposed plan was implemented elsewhere", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          latestTurn: makeLatestTurn(),
          proposedPlans: [
            {
              id: "plan-1" as never,
              turnId: "turn-1" as never,
              createdAt: "2026-03-09T10:00:00.000Z",
              updatedAt: "2026-03-09T10:05:00.000Z",
              planMarkdown: "# Plan",
              implementedAt: "2026-03-09T10:06:00.000Z",
              implementationThreadId: "thread-implement" as never,
            },
          ],
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });

  it("shows completed when there is an unseen completion and no active blocker", () => {
    expect(
      resolveThreadStatusPill({
        thread: {
          ...baseThread,
          interactionMode: "default",
          latestTurn: makeLatestTurn(),
          lastVisitedAt: "2026-03-09T10:04:00.000Z",
          session: {
            ...baseThread.session,
            status: "ready",
            orchestrationStatus: "ready",
          },
        },
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      }),
    ).toMatchObject({ label: "Completed", pulse: false });
  });
});

describe("resolveThreadRowClassName", () => {
  it("uses the darker selected palette when a thread is both selected and active", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: true });
    expect(className).toContain("bg-primary/22");
    expect(className).toContain("hover:bg-primary/26");
    expect(className).toContain("dark:bg-primary/30");
    expect(className).not.toContain("bg-accent/85");
  });

  it("uses selected hover colors for selected threads", () => {
    const className = resolveThreadRowClassName({ isActive: false, isSelected: true });
    expect(className).toContain("bg-primary/15");
    expect(className).toContain("hover:bg-primary/19");
    expect(className).toContain("dark:bg-primary/22");
    expect(className).not.toContain("hover:bg-accent");
  });

  it("keeps the accent palette for active-only threads", () => {
    const className = resolveThreadRowClassName({ isActive: true, isSelected: false });
    expect(className).toContain("bg-accent/85");
    expect(className).toContain("hover:bg-accent");
  });
});

describe("resolveProjectStatusIndicator", () => {
  it("returns null when no threads have a notable status", () => {
    expect(resolveProjectStatusIndicator([null, null])).toBeNull();
  });

  it("surfaces the highest-priority actionable state across project threads", () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: "Completed",
          colorClass: "text-emerald-600",
          dotClass: "bg-emerald-500",
          pulse: false,
        },
        {
          label: "Pending Approval",
          colorClass: "text-amber-600",
          dotClass: "bg-amber-500",
          pulse: false,
        },
        {
          label: "Working",
          colorClass: "text-sky-600",
          dotClass: "bg-sky-500",
          pulse: true,
        },
      ]),
    ).toMatchObject({ label: "Pending Approval", dotClass: "bg-amber-500" });
  });

  it("prefers plan-ready over completed when no stronger action is needed", () => {
    expect(
      resolveProjectStatusIndicator([
        {
          label: "Completed",
          colorClass: "text-emerald-600",
          dotClass: "bg-emerald-500",
          pulse: false,
        },
        {
          label: "Plan Ready",
          colorClass: "text-violet-600",
          dotClass: "bg-violet-500",
          pulse: false,
        },
      ]),
    ).toMatchObject({ label: "Plan Ready", dotClass: "bg-violet-500" });
  });
});
