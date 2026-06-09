# Plan: Fix Project Remove Missing `force: true`

## Problem

Removing a project from the sidebar can fail with:

> "Orchestration command invariant failed (project.delete): Project '...' is not empty
> and cannot be deleted without force=true."

This happens when the client's thread count disagrees with the server's.

## Root Cause

`Sidebar.tsx` has two code paths for project removal, both depending on
`memberThreadCountByPhysicalKey` (a client-side count from `sidebarThreadSummaryById`):

1. **Count > 0** -> shows warning toast -> "Delete anyway" -> `removeProject(member, { force: true })`
2. **Count == 0** -> shows simple confirm -> `removeProject(member)` with no `force` flag

The client count can be 0 even when the server has threads (e.g. a recently-created thread
may be registered in the DB but not yet loaded into the sidebar summary cache). In that case
the request falls through to path 2, sends `project.delete` without `force: true`, and the
server invariant rejects it.

**Delete is fully soft** - all data stays in the SQLite DB and event store. Passing
`force: true` only triggers the same soft-deletes earlier in the command sequence.

## Fix

**File:** `apps/web/src/components/Sidebar.tsx`  
**Line:** ~1404

```diff
- await removeProject(member);
+ await removeProject(member, { force: true });
```

That's it. One line. No new types, no new store logic, no new server commands.

## Why this is safe

- `project.delete` with `force: true` just soft-deletes threads first, then the project
- No data is physically removed - `deletedAt` is set on each record
- Event store is append-only, never purged
- Provider session runtime, cursor sessions, and project files are untouched

## Testing

- Open a project with 0 threads -> remove -> works
- Open a project with threads -> remove -> works (existing path)
- Open a project where threads exist server-side but haven't loaded into sidebar yet -> remove -> works
