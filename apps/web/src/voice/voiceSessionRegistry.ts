import type { ThreadId } from "@t3tools/contracts";

let activeThreadId: ThreadId | null = null;
let activeDispose: (() => void) | null = null;

export function registerVoiceSession(threadId: ThreadId, dispose: () => void) {
  if (activeThreadId && activeThreadId !== threadId) {
    activeDispose?.();
  }
  activeThreadId = threadId;
  activeDispose = dispose;
}

export function releaseVoiceSession(threadId: ThreadId) {
  if (activeThreadId !== threadId) {
    return;
  }
  activeThreadId = null;
  activeDispose = null;
}
