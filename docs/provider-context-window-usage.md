# Provider Context Window Usage

T3 Code renders the composer context-window meter from orchestration activity, not directly from
provider-specific protocols. Provider adapters should standardize usage signals into the runtime
event `thread.token-usage.updated`; orchestration projects that event into
`context-window.updated`, and the web composer derives the latest visible meter from that activity.

This keeps the UI contract stable while each provider maps its own usage telemetry locally.

## Runtime Contract

Adapters emit `thread.token-usage.updated` with a `ThreadTokenUsageSnapshot` payload.

- `usedTokens` is required and must be positive.
- `maxTokens` is optional. When present, the UI can show percentage used; otherwise it shows tokens
  used.
- Input, output, reasoning, and cached token fields are optional details for diagnostics and future
  display.
- Raw provider payloads should be preserved on the runtime event for native diagnostics.

No provider should introduce a separate frontend protocol for context-window display.

## Cursor ACP

Cursor runs through ACP, so Cursor usage has two sources:

- `sessionUpdate: "usage_update"` is primary. The ACP parser maps `used` to `usedTokens` and maps
  positive `size` to `maxTokens`.
- `PromptResponse.usage` is a fallback after `session/prompt` resolves, used only when no ACP
  usage update was observed for that turn.

The fallback maps ACP prompt usage totals to `usedTokens`, `inputTokens`, `outputTokens`,
`reasoningOutputTokens`, and `cachedInputTokens`. It intentionally omits `maxTokens` because
Cursor's prompt response does not provide a live context limit.

Cursor's `contextWindow` model option is configuration only. It is not treated as usage.

## OpenCode

OpenCode usage comes from SDK events:

- Assistant `message.updated` events can include message-level token totals.
- Assistant `step-finish` parts can include live step token totals; this is the path used by some
  OpenCode models when assistant message totals are not enough for live metering.

At session startup, the adapter loads OpenCode inventory once and builds a
`providerID/modelID -> context limit` map from `model.limit.context`. Inventory failures are
non-fatal: the adapter logs/debugs and still emits token-only usage when token totals are available.

OpenCode usage normalizes `tokens.total` when present; otherwise it sums input, output, reasoning,
cache read, and cache write tokens. Repeated identical usage snapshots are deduplicated by message
or step-finish id plus the token/max-token signature.

## Tests

Provider tests should verify observable runtime events:

- ACP `usage_update` parses into a usage event with `usedTokens` and optional `maxTokens`.
- Cursor emits usage from ACP updates, falls back to `PromptResponse.usage`, and keeps ACP updates
  primary when both are present.
- OpenCode emits usage from assistant messages and `step-finish` parts, includes inventory limits
  when available, deduplicates repeated snapshots, and still emits token-only usage when inventory
  lookup fails.
