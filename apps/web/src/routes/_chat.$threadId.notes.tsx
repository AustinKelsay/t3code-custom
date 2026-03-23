import { ThreadId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import ThreadNotesPage from "../components/ThreadNotesPage";
import { ThreadPageHeader } from "../components/chat/ThreadPageHeader";
import { APP_VIEWPORT_CSS_HEIGHT } from "../lib/viewport";
import { resolveThreadTargetId } from "../threadTarget";
import { useThreadRouteData } from "../threadRouteData";
import { SidebarInset } from "~/components/ui/sidebar";

function ThreadNotesRouteView() {
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
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

  if (!threadsHydrated || !routeThreadExists || !activeThread) {
    return null;
  }

  return (
    <SidebarInset
      className="min-h-0 overflow-y-auto overscroll-y-contain bg-background text-foreground"
      style={{ height: APP_VIEWPORT_CSS_HEIGHT }}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 px-3 py-2 backdrop-blur sm:px-5 sm:py-3">
          <ThreadPageHeader
            activeProjectName={activeProject?.name}
            activeTab="notes"
            activeThreadId={activeThread.id}
            activeThreadTitle={activeThread.title}
            gitCwd={gitCwd}
            openInCwd={gitCwd}
            targetId={targetId}
          />
        </header>
        <ThreadNotesPage threadId={threadId} />
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/$threadId/notes")({
  component: ThreadNotesRouteView,
});
