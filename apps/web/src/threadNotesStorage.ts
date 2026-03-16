import { type ThreadId } from "@t3tools/contracts";

const THREAD_NOTES_STORAGE_KEY = "t3code:thread-notes:v1";
const THREAD_NOTES_BACKUP_STORAGE_KEY = "t3code:thread-notes-backup:v1";

interface LegacyThreadNotesSnapshot {
  readonly state?: {
    readonly notesByThreadId?: Record<string, string>;
  };
  readonly version?: number;
}

interface ThreadNotesBackupRecord {
  readonly notes: string;
  readonly updatedAt: string;
}

interface ThreadNotesBackupSnapshot {
  readonly byThreadId?: Record<string, ThreadNotesBackupRecord>;
}

function readLegacySnapshot(): LegacyThreadNotesSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(THREAD_NOTES_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as LegacyThreadNotesSnapshot;
  } catch {
    return null;
  }
}

function readBackupSnapshot(): ThreadNotesBackupSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(THREAD_NOTES_BACKUP_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as ThreadNotesBackupSnapshot;
  } catch {
    return null;
  }
}

export function readLegacyThreadNotes(threadId: ThreadId): string {
  const snapshot = readLegacySnapshot();
  const notes = snapshot?.state?.notesByThreadId?.[threadId];
  return typeof notes === "string" ? notes : "";
}

export function clearLegacyThreadNotes(threadId: ThreadId): void {
  const snapshot = readLegacySnapshot();
  const notesByThreadId = snapshot?.state?.notesByThreadId;
  if (
    !notesByThreadId ||
    !Object.hasOwn(notesByThreadId, threadId) ||
    typeof window === "undefined"
  ) {
    return;
  }

  const { [threadId]: _removed, ...rest } = notesByThreadId;
  if (Object.keys(rest).length === 0) {
    window.localStorage.removeItem(THREAD_NOTES_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    THREAD_NOTES_STORAGE_KEY,
    JSON.stringify({
      ...snapshot,
      state: {
        ...snapshot?.state,
        notesByThreadId: rest,
      },
    }),
  );
}

export function readThreadNotesBackup(threadId: ThreadId): ThreadNotesBackupRecord | null {
  const snapshot = readBackupSnapshot();
  const backup = snapshot?.byThreadId?.[threadId];
  if (!backup || typeof backup.notes !== "string" || typeof backup.updatedAt !== "string") {
    return null;
  }
  return backup;
}

export function writeThreadNotesBackup(threadId: ThreadId, notes: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const snapshot = readBackupSnapshot();
  const nextByThreadId = {
    ...snapshot?.byThreadId,
    [threadId]: {
      notes,
      updatedAt: new Date().toISOString(),
    },
  } satisfies Record<string, ThreadNotesBackupRecord>;

  window.localStorage.setItem(
    THREAD_NOTES_BACKUP_STORAGE_KEY,
    JSON.stringify({ byThreadId: nextByThreadId }),
  );
}

export function clearThreadNotesBackup(threadId: ThreadId): void {
  const snapshot = readBackupSnapshot();
  const byThreadId = snapshot?.byThreadId;
  if (!byThreadId || !Object.hasOwn(byThreadId, threadId) || typeof window === "undefined") {
    return;
  }

  const { [threadId]: _removed, ...rest } = byThreadId;
  if (Object.keys(rest).length === 0) {
    window.localStorage.removeItem(THREAD_NOTES_BACKUP_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(
    THREAD_NOTES_BACKUP_STORAGE_KEY,
    JSON.stringify({
      byThreadId: rest,
    }),
  );
}
