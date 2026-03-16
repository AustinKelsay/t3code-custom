import type { ThreadId } from "@t3tools/contracts";

export type ThreadSessionTab = "chat" | "code" | "notes";

export const THREAD_SESSION_TABS = [
  { value: "chat", label: "Chat" },
  { value: "code", label: "Code" },
  { value: "notes", label: "Notes" },
] as const satisfies ReadonlyArray<{
  readonly value: ThreadSessionTab;
  readonly label: string;
}>;

export function getThreadTabRoute(
  tab: ThreadSessionTab,
): "/$threadId" | "/$threadId/diff" | "/$threadId/notes" {
  switch (tab) {
    case "chat":
      return "/$threadId";
    case "code":
      return "/$threadId/diff";
    case "notes":
      return "/$threadId/notes";
  }
}

export function getThreadTabLabel(tab: ThreadSessionTab): string {
  return THREAD_SESSION_TABS.find((entry) => entry.value === tab)?.label ?? "Chat";
}

export function buildThreadTabParams(threadId: ThreadId): { threadId: ThreadId } {
  return { threadId };
}
