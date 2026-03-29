import type { Thread } from "./types";

function compareDesc(left: number, right: number): number {
  return right - left;
}

export function sortThreadsForProject<
  T extends Pick<Thread, "id" | "createdAt" | "pinnedAt" | "sortOrder">,
>(threads: readonly T[]): T[] {
  return [...threads].toSorted((left, right) => {
    const byPinnedState = Number(right.pinnedAt !== null) - Number(left.pinnedAt !== null);
    if (byPinnedState !== 0) return byPinnedState;

    const leftSortOrder = left.sortOrder ?? Number.NEGATIVE_INFINITY;
    const rightSortOrder = right.sortOrder ?? Number.NEGATIVE_INFINITY;
    const bySortOrder = compareDesc(leftSortOrder, rightSortOrder);
    if (bySortOrder !== 0) return bySortOrder;

    const byCreatedAt = compareDesc(Date.parse(left.createdAt), Date.parse(right.createdAt));
    if (byCreatedAt !== 0) return byCreatedAt;

    return right.id.localeCompare(left.id);
  });
}

export function assignThreadSortOrders<T extends Pick<Thread, "id">>(
  threadsInDisplayOrder: readonly T[],
): Map<T["id"], number> {
  const total = threadsInDisplayOrder.length;
  return new Map(threadsInDisplayOrder.map((thread, index) => [thread.id, total - index] as const));
}
