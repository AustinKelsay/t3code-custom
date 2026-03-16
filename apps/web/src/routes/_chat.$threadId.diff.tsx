import { ThreadId } from "@t3tools/contracts";
import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { Suspense, useEffect } from "react";

import DiffPanel from "../components/DiffPanel";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
} from "../components/DiffPanelShell";
import { ThreadPageHeader } from "../components/chat/ThreadPageHeader";
import { type DiffRouteSearch, parseDiffRouteSearch } from "../diffRouteSearch";
import { APP_VIEWPORT_CSS_HEIGHT } from "../lib/viewport";
import { resolveThreadTargetId } from "../threadTarget";
import { useThreadRouteData } from "../threadRouteData";
import { SidebarInset } from "~/components/ui/sidebar";

function FullDiffLoadingFallback() {
  return (
    <DiffPanelShell mode="sheet" header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading full diff..." />
    </DiffPanelShell>
  );
}

function FullDiffRouteView() {
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  const { activeProject, activeThread, routeThreadExists, threadsHydrated } =
    useThreadRouteData(threadId);
  const gitCwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;
  const targetId = resolveThreadTargetId({
    thread: activeThread,
    projectTargetId: activeProject?.targetId ?? null,
  });

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    if (!routeThreadExists) {
      void navigate({ to: "/", replace: true });
    }
  }, [navigate, routeThreadExists, threadsHydrated]);

  if (!threadsHydrated || !routeThreadExists) {
    return null;
  }

  return (
    <SidebarInset
      className="min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground"
      style={{ height: APP_VIEWPORT_CSS_HEIGHT }}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeThread && (
          <header className="border-b border-border px-3 py-2 sm:px-5 sm:py-3">
            <ThreadPageHeader
              activeProjectName={activeProject?.name}
              activeTab="code"
              activeThreadId={activeThread.id}
              activeThreadTitle={activeThread.title}
              gitCwd={gitCwd}
              openInCwd={gitCwd}
              targetId={targetId}
            />
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">
          <DiffWorkerPoolProvider>
            <Suspense fallback={<FullDiffLoadingFallback />}>
              <DiffPanel
                mode="sheet"
                variant="full"
                onCloseDiff={() => {
                  void navigate({
                    to: "/$threadId",
                    params: { threadId },
                    replace: true,
                    search: {
                      diff: "1",
                      ...(search.diffScope ? { diffScope: search.diffScope } : {}),
                      ...(search.diffTurnId ? { diffTurnId: search.diffTurnId } : {}),
                      ...(search.diffFilePath ? { diffFilePath: search.diffFilePath } : {}),
                    },
                  });
                }}
              />
            </Suspense>
          </DiffWorkerPoolProvider>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/$threadId/diff")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diffScope", "diffTurnId", "diffFilePath"])],
  },
  component: FullDiffRouteView,
});
