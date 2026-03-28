import { ThreadId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import ThreadNotesPage from "../components/ThreadNotesPage";
import { ThreadPageHeader } from "../components/chat/ThreadPageHeader";
import {
  resolveProjectHeaderClassName,
  resolveProjectHeaderStyle,
} from "../components/chat/projectHeaderTheme";
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
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    if (!routeThreadExists) {
      void navigate({ to: "/", replace: true });
    }
  }, [navigate, routeThreadExists, threadsHydrated]);

  useLayoutEffect(() => {
    const headerElement = headerRef.current;
    if (!headerElement) {
      return;
    }

    const updateHeaderHeight = () => {
      setHeaderHeight((currentHeight) => {
        const nextHeight = Math.round(headerElement.getBoundingClientRect().height);
        return currentHeight === nextHeight ? currentHeight : nextHeight;
      });
    };

    updateHeaderHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateHeaderHeight();
    });
    observer.observe(headerElement);
    return () => {
      observer.disconnect();
    };
  }, [activeProject?.color, activeThread?.id, activeThread?.title]);

  if (!threadsHydrated || !routeThreadExists || !activeThread) {
    return null;
  }

  return (
    <SidebarInset
      className="min-h-0 overflow-y-auto overscroll-y-contain bg-background text-foreground"
      style={
        {
          "--thread-notes-header-height": `${headerHeight}px`,
          height: APP_VIEWPORT_CSS_HEIGHT,
        } as CSSProperties
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <header
          ref={headerRef}
          className={resolveProjectHeaderClassName(
            "sticky top-0 z-30 border-b px-3 py-2 backdrop-blur sm:px-5 sm:py-3",
            activeProject?.color ?? null,
          )}
          style={resolveProjectHeaderStyle(activeProject?.color ?? null)}
        >
          <ThreadPageHeader
            activeProjectColor={activeProject?.color ?? null}
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
