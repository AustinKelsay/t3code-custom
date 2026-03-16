import { type ThreadId } from "@t3tools/contracts";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { ensureNativeApi } from "../nativeApi";
import {
  clearLegacyThreadNotes,
  clearThreadNotesBackup,
  readLegacyThreadNotes,
  readThreadNotesBackup,
  writeThreadNotesBackup,
} from "../threadNotesStorage";

const THREAD_NOTES_SAVE_DEBOUNCE_MS = 500;

export const threadNotesQueryKeys = {
  all: ["threadNotes"] as const,
  byThread: (threadId: ThreadId | null) => ["threadNotes", threadId] as const,
};

function normalizeThreadNotesErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Failed to sync thread notes.";
}

export function threadNotesQueryOptions(threadId: ThreadId | null) {
  return queryOptions({
    queryKey: threadNotesQueryKeys.byThread(threadId),
    queryFn: async () => {
      if (!threadId) {
        throw new Error("Thread notes are unavailable.");
      }
      return ensureNativeApi().threads.getNotes({ threadId });
    },
    enabled: threadId !== null,
  });
}

interface UseThreadNotesDocumentResult {
  readonly editorInstanceKey: string;
  readonly notes: string;
  readonly setNotes: (notes: string) => void;
  readonly isLoading: boolean;
  readonly isSaving: boolean;
  readonly errorMessage: string | null;
}

export function useThreadNotesDocument(threadId: ThreadId): UseThreadNotesDocumentResult {
  const queryClient = useQueryClient();
  const threadNotesQuery = useQuery(threadNotesQueryOptions(threadId));
  const [notes, setNotesState] = useState("");
  const [editorInstanceVersion, setEditorInstanceVersion] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const latestNotesRef = useRef("");
  const lastSavedNotesRef = useRef("");
  const legacyNotesRef = useRef("");
  const backupNotesRef = useRef<{ notes: string; updatedAt: string } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef(false);
  const queuedImmediateSaveRef = useRef(false);
  const hydratedThreadIdRef = useRef<ThreadId | null>(null);

  const flushSave = useCallback(async () => {
    if (saveInFlightRef.current) {
      queuedImmediateSaveRef.current = true;
      return;
    }

    const nextNotes = latestNotesRef.current;
    if (nextNotes === lastSavedNotesRef.current) {
      setIsSaving(false);
      return;
    }

    saveInFlightRef.current = true;
    setIsSaving(true);
    setErrorMessage(null);

    try {
      const saved = await ensureNativeApi().threads.upsertNotes({
        threadId,
        notes: nextNotes,
      });
      lastSavedNotesRef.current = saved.notes;
      queryClient.setQueryData(threadNotesQueryKeys.byThread(threadId), saved);
      clearThreadNotesBackup(threadId);
      backupNotesRef.current = null;

      if (legacyNotesRef.current.length > 0) {
        clearLegacyThreadNotes(threadId);
        legacyNotesRef.current = "";
      }
    } catch (error) {
      setErrorMessage(normalizeThreadNotesErrorMessage(error));
    } finally {
      saveInFlightRef.current = false;

      if (queuedImmediateSaveRef.current || latestNotesRef.current !== lastSavedNotesRef.current) {
        queuedImmediateSaveRef.current = false;
        void flushSave();
      } else {
        setIsSaving(false);
      }
    }
  }, [queryClient, threadId]);

  const scheduleSave = useCallback(
    (immediate = false) => {
      if (!isHydrated) {
        return;
      }

      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      if (latestNotesRef.current === lastSavedNotesRef.current) {
        setIsSaving(false);
        return;
      }

      if (immediate) {
        void flushSave();
        return;
      }

      setIsSaving(true);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void flushSave();
      }, THREAD_NOTES_SAVE_DEBOUNCE_MS);
    },
    [flushSave, isHydrated],
  );

  useEffect(() => {
    legacyNotesRef.current = readLegacyThreadNotes(threadId);
    backupNotesRef.current = readThreadNotesBackup(threadId);
    hydratedThreadIdRef.current = null;
    latestNotesRef.current = "";
    lastSavedNotesRef.current = "";
    queuedImmediateSaveRef.current = false;
    saveInFlightRef.current = false;
    setNotesState("");
    setEditorInstanceVersion(0);
    setIsHydrated(false);
    setIsSaving(false);
    setErrorMessage(null);

    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, [threadId]);

  useEffect(() => {
    if (threadNotesQuery.status === "success" && hydratedThreadIdRef.current !== threadId) {
      const serverNotes = threadNotesQuery.data?.notes ?? "";
      const serverUpdatedAt = threadNotesQuery.data?.updatedAt ?? "";
      const legacyNotes = legacyNotesRef.current;
      const backup = backupNotesRef.current;
      const shouldUseBackup =
        backup !== null &&
        backup.notes !== serverNotes &&
        (serverUpdatedAt.length === 0 || backup.updatedAt >= serverUpdatedAt);
      const initialNotes = shouldUseBackup
        ? backup.notes
        : serverNotes.length > 0
          ? serverNotes
          : legacyNotes;

      latestNotesRef.current = initialNotes;
      lastSavedNotesRef.current = serverNotes;
      setNotesState(initialNotes);
      setEditorInstanceVersion((currentVersion) => currentVersion + 1);
      setIsHydrated(true);
      setErrorMessage(null);
      hydratedThreadIdRef.current = threadId;

      if (serverNotes.length > 0 && legacyNotes.length > 0) {
        clearLegacyThreadNotes(threadId);
        legacyNotesRef.current = "";
      }

      if (shouldUseBackup || (serverNotes.length === 0 && legacyNotes.length > 0)) {
        void flushSave();
      }
    }
  }, [flushSave, threadId, threadNotesQuery.data, threadNotesQuery.status]);

  useEffect(() => {
    if (threadNotesQuery.status !== "error" || hydratedThreadIdRef.current === threadId) {
      return;
    }

    const legacyNotes = legacyNotesRef.current;
    latestNotesRef.current = legacyNotes;
    lastSavedNotesRef.current = legacyNotes;
    setNotesState(legacyNotes);
    setEditorInstanceVersion((currentVersion) => currentVersion + 1);
    setIsHydrated(true);
    setIsSaving(false);
    setErrorMessage(normalizeThreadNotesErrorMessage(threadNotesQuery.error));
    hydratedThreadIdRef.current = threadId;
  }, [threadId, threadNotesQuery.error, threadNotesQuery.status]);

  useEffect(() => {
    const flushOnPageHide = (event: PageTransitionEvent | Event) => {
      if (event.type === "visibilitychange" && document.visibilityState !== "hidden") {
        return;
      }
      scheduleSave(true);
    };

    window.addEventListener("pagehide", flushOnPageHide);
    window.addEventListener("visibilitychange", flushOnPageHide);

    return () => {
      window.removeEventListener("pagehide", flushOnPageHide);
      window.removeEventListener("visibilitychange", flushOnPageHide);

      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      if (latestNotesRef.current !== lastSavedNotesRef.current) {
        queuedImmediateSaveRef.current = false;
        void flushSave();
      }
    };
  }, [flushSave, scheduleSave]);

  const setNotes = useCallback(
    (nextNotes: string) => {
      latestNotesRef.current = nextNotes;
      writeThreadNotesBackup(threadId, nextNotes);
      setNotesState((currentNotes) => (currentNotes === nextNotes ? currentNotes : nextNotes));
      scheduleSave();
    },
    [scheduleSave, threadId],
  );

  return {
    editorInstanceKey: `${threadId}:${editorInstanceVersion}`,
    notes,
    setNotes,
    isLoading: !isHydrated && threadNotesQuery.isPending,
    isSaving,
    errorMessage,
  };
}
