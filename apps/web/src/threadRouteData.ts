import { DEFAULT_MODEL_BY_PROVIDER, type ThreadId } from "@t3tools/contracts";
import { useMemo } from "react";
import { useComposerDraftStore } from "./composerDraftStore";
import { buildLocalDraftThread } from "./components/ChatView.logic";
import { useStore } from "./store";

export function useThreadRouteData(threadId: ThreadId) {
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const projects = useStore((store) => store.projects);
  const serverThread = useStore(
    (store) => store.threads.find((thread) => thread.id === threadId) ?? null,
  );
  const draftThread = useComposerDraftStore(
    (store) => store.draftThreadsByThreadId[threadId] ?? null,
  );
  const activeProject = useMemo(
    () =>
      projects.find(
        (project) => project.id === (serverThread?.projectId ?? draftThread?.projectId),
      ) ?? null,
    [draftThread?.projectId, projects, serverThread?.projectId],
  );
  const activeThread = useMemo(() => {
    if (serverThread) {
      return serverThread;
    }
    if (!draftThread) {
      return null;
    }
    return buildLocalDraftThread(
      threadId,
      draftThread,
      activeProject?.model ?? DEFAULT_MODEL_BY_PROVIDER.codex,
      null,
    );
  }, [activeProject?.model, draftThread, serverThread, threadId]);

  return {
    threadsHydrated,
    routeThreadExists: activeThread !== null,
    activeProject,
    activeThread,
  };
}
