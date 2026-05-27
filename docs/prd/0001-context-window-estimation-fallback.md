# PRD: Context Window Meter Estimation Fallback

## Problem Statement

The context window meter in the chat composer footer only shows when the provider emits live
token usage data. For Cursor, both data sources are UNSTABLE ACP features (`usage_update` session
notification and `PromptResponse.usage`) that the Cursor Agent CLI may not implement. When neither
live source provides data, the meter never renders — users have zero visibility into context
window consumption.

This is not a Cursor-specific problem. Any future ACP-based provider (or any provider without live
usage telemetry) will have the same gap. The meter should degrade gracefully to estimated usage
rather than disappearing entirely.

## Solution

Add a **client-side estimation fallback** to `deriveLatestContextWindowSnapshot`. When no
`context-window.updated` orchestration activity exists in the thread, synthesize a
`ContextWindowSnapshot` using:

- **`maxTokens`**: parsed from the model selection `contextWindow` option (e.g. "200k" → 200,000).
  This option is already collected in the TraitsPicker and stored in `ModelSelection.options`.
- **`usedTokens`**: estimated from the thread message content using a character-to-token heuristic
  (~4 chars/token).

Live provider data always takes priority. The estimation fallback only activates when no
`context-window.updated` activity exists. When live data arrives later (e.g. the agent starts
sending `usage_update`), the meter transparently switches to live data.

## User Stories

1. As a developer using Cursor, I want to see my approximate context window usage in the composer
   footer, so that I know how much context I have consumed during a session.

2. As a developer using Cursor, I want the context window meter to show my selected context window
   size (200k, 1m, etc.) as the maximum, so that I understand the capacity of my current model.

3. As a developer using Cursor, I want the estimated usage to be visually distinguishable from live
   provider data, so that I know when numbers are approximate vs. precise.

4. As a developer using any ACP-based provider, I want the context window meter to work without
   requiring the agent to implement UNSTABLE protocol features, so that I get consistent UX across
   providers.

5. As a developer using Cursor, I want the meter to transparently upgrade to live data when the
   agent starts sending `usage_update` notifications, so that I get precise numbers as soon as they
   are available.

6. As a developer, I want the meter to still work when I switch models mid-session, so that the
   context window capacity updates to reflect the new model selection.

7. As a developer, I want the estimated usage to increase as I send more messages, so that the
   meter reflects growing context consumption even without live provider data.

8. As a developer using Codex (where live usage works), I want no regression — the meter should
   continue showing live data exactly as it does today.

## Implementation Decisions

### 1. Context window token value parsing (new shared module)

Extract a new module `contextWindowEstimation` in the shared package. This is a deep module with a
simple interface:

- `parseContextWindowTokenValue(value: string): number | null` — parses "200k" → 200000,
  "1m" → 1000000, "1.5m" → 1500000, plain numbers as-is. Returns null for unrecognized formats.
- `resolveContextWindowLimit(options): number | null` — extracts the `maxTokens` value from a
  `ModelSelection.options` array by finding the `contextWindow` option and parsing its value.
- `estimateContentTokens(segments): number` — sums character counts across text segments and
  divides by a configurable chars-per-token ratio (default 4).

These functions are pure, stateless, and testable in isolation. They have no dependency on React,
providers, or orchestration.

### 2. Extend `deriveLatestContextWindowSnapshot`

The function signature gains an optional second parameter:

```typescript
export function deriveLatestContextWindowSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  fallback?: { maxTokens: number | null; usedTokens: number | null },
): ContextWindowSnapshot | null;
```

Behavior:

- When a valid `context-window.updated` activity exists → same behavior as today (returns live
  snapshot)
- When no activity exists AND `fallback.maxTokens > 0` AND `fallback.usedTokens > 0` →
  synthesize a snapshot with `compactsAutomatically: true` (since we know Cursor auto-compacts)
  and `updatedAt` set to the current time
- When no activity exists AND fallback data is insufficient → return null (meter stays hidden)

### 3. Pass fallback data from ChatComposer

In `ChatComposer`, compute two values and pass them to `deriveLatestContextWindowSnapshot`:

- `fallbackMaxTokens`: resolved from `activeThreadModelSelection.options` using
  `resolveContextWindowLimit`
- `fallbackUsedTokens`: estimated from `activeThread.messages` message content using
  `estimateContentTokens`

These values are computed via `useMemo` keyed on the model selection options and message content,
so they only recalculate when the data changes.

### 4. ContextWindowMeter visual treatment (minimal)

When `ContextWindowSnapshot.usedTokens` is estimated (not from a provider event), the meter should
use a muted/dashed stroke style or slightly reduced opacity to visually distinguish estimated from
live data. This is communicated via a new optional `source` field on the snapshot type
(`"live" | "estimated"`).

### 5. Scope and constraints

- Server-side changes: **none**. This is purely a client-side display enhancement.
- Provider adapter changes: **none**. The existing ACP notification and prompt response paths are
  correct and continue to work when the agent provides data.
- The `contextWindow` option is configuration-only (per existing docs). This PRD treats it as a
  display hint for the meter, not as runtime session configuration.

## Testing Decisions

Tests should verify observable behavior, not implementation details:

1. **`contextWindowEstimation.test.ts`** — test `parseContextWindowTokenValue` with good inputs
   (200k, 1m, 1.5m, 500), bad inputs (empty, invalid), and edge cases. Test
   `resolveContextWindowLimit` with options arrays containing contextWindow, missing it, and mixed
   with other options. Test `estimateContentTokens` with varying text lengths and character counts.

2. **`contextWindow.test.ts`** — extend existing tests:
   - Fallback synthesis: when no activities have `context-window.updated`, with valid fallback data,
     returns a snapshot with expected `maxTokens` and `usedTokens`
   - No fallback: when no activities and no fallback data, returns null (existing behavior preserved)
   - Live priority: when activities exist AND fallback data is provided, live data wins
   - Zero fallback usedTokens: null return (consistent with server-side `usedTokens <= 0` filtering)

Prior art: the existing `contextWindow.test.ts` tests `deriveLatestContextWindowSnapshot` with
activity-based data. The new tests follow the same pattern.

## Out of Scope

- Accurate token counting (tiktoken or model-specific tokenizers). The 4 chars/token heuristic is
  intentionally approximate.
- Per-turn precise usage tracking without provider data. The estimation is session-level.
- Showing the meter during a local draft thread (no server thread = no model selection = no
  fallback data).
- Changing the runtime contract with Cursor agents. We are not requesting the agent to implement
  UNSTABLE features.
- Server-side token accounting for Cursor. This is display-only.

## Further Notes

- The `usage_update` and `PromptResponse.usage` ACP features are marked UNSTABLE in schema
  v0.11.3. There is no capability negotiation for them — agents may or may not send them.
- OpenCode already has a similar pattern of using static context limits from model inventory when
  live data is unavailable. This PRD applies the same principle to Cursor but uses the
  user-selected context window option instead of inventory data.
- The existing docs at `docs/provider-context-window-usage.md` should be updated to document the
  estimation fallback behavior.
- The shared module should use subpath exports from `@t3tools/shared` (e.g.
  `@t3tools/shared/contextWindowEstimation`) following the repo convention of no barrel index.
