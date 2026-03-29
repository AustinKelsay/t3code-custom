import { type ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import { ArchiveIcon, ArchiveRestoreIcon } from "lucide-react";
import { newCommandId } from "../../lib/utils";
import { readNativeApi } from "../../nativeApi";
import { useStore } from "../../store";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

function formatRelativeTimeLabel(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.round(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.round(diffMonths / 12)}y ago`;
}

export function ArchivedThreadsSection() {
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);

  const archivedGroups = useMemo(() => {
    return projects
      .map((project) => ({
        project,
        threads: threads
          .filter(
            (thread) => thread.projectId === project.id && (thread.archivedAt ?? null) !== null,
          )
          .toSorted((left, right) => {
            const leftKey = left.archivedAt ?? left.createdAt;
            const rightKey = right.archivedAt ?? right.createdAt;
            return new Date(rightKey).getTime() - new Date(leftKey).getTime();
          }),
      }))
      .filter((group) => group.threads.length > 0);
  }, [projects, threads]);

  const handleUnarchiveThread = async (threadId: ThreadId) => {
    const api = readNativeApi();
    if (!api) return;

    try {
      await api.orchestration.dispatchCommand({
        type: "thread.unarchive",
        commandId: newCommandId(),
        threadId,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to unarchive thread",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  };

  if (archivedGroups.length === 0) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center">
        <div className="rounded-full border border-border bg-background p-3 text-muted-foreground">
          <ArchiveIcon className="size-5" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-foreground">No archived threads</h3>
          <p className="text-xs text-muted-foreground">
            Archived threads will appear here after you archive them from the sidebar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {archivedGroups.map(({ project, threads: projectThreads }) => (
        <div key={project.id} className="overflow-hidden rounded-2xl border bg-card shadow-xs/5">
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <h3 className="truncate text-sm font-medium text-foreground">{project.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {projectThreads.length} archived thread{projectThreads.length === 1 ? "" : "s"}
            </p>
          </div>

          {projectThreads.map((thread) => (
            <div
              key={thread.id}
              className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
            >
              <div className="min-w-0 flex-1">
                <h4 className="truncate text-sm font-medium text-foreground">{thread.title}</h4>
                <p className="text-xs text-muted-foreground">
                  Archived {formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt)}
                  {" · Created "}
                  {formatRelativeTimeLabel(thread.createdAt)}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 gap-1.5"
                onClick={() => void handleUnarchiveThread(thread.id)}
              >
                <ArchiveRestoreIcon className="size-3.5" />
                <span>Unarchive</span>
              </Button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
