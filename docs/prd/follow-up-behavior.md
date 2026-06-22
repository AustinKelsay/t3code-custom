# Follow-Up Behavior: Queue and Steer

## Problem Statement

When a user sends another message while a thread has an active turn, T3 Code currently treats the composer primarily as an interrupt surface rather than a safe follow-up surface. Users need to be able to capture their next instruction without disrupting active work, and Codex users also expect native same-turn steering behavior that appends additional input to the active turn. The current behavior makes long-running agent work feel fragile, especially across reconnects, slow provider responses, and partial stream failures.

## Solution

Add a first-class Follow-Up Behavior system with two behaviors:

- Queue: capture the message as a queued turn that becomes a normal turn when the thread is ready.
- Steer: append steerable input to the currently active turn when the provider supports native steering.

Queue is the default behavior. Steer is available as an explicit alternate behavior for providers with native steer support. Providers without steer support visibly fall back to Queue. Queued turns are durable, ordered, recoverable, and support the full normal turn payload. Steer entries are persisted as part of the active turn history and are not shown as standalone user messages.

## User Stories

1. As a T3 Code user, I want messages sent during an active turn to be captured safely, so that I do not accidentally interrupt the agent.
2. As a T3 Code user, I want Queue to be the default follow-up behavior, so that long-running work remains predictable.
3. As a T3 Code user, I want a queued turn to send automatically when the thread becomes ready, so that I do not need to babysit the session.
4. As a T3 Code user, I want queued turns to survive refreshes and reconnects, so that my follow-up instructions are not lost.
5. As a T3 Code user, I want queued turns to preserve the full normal turn payload, so that text, images, attachments, and terminal context work the same way when queued.
6. As a T3 Code user, I want queued turns to preserve model, runtime, and interaction settings from the moment they were queued, so that queued intent does not silently change later.
7. As a T3 Code user, I want to see queued turns near the composer, so that I know what will run next.
8. As a T3 Code user, I want lightweight timeline visibility for queued turns, so that thread history explains why work is pending.
9. As a T3 Code user, I want failed queued turns to show an error, so that I know why the queue stopped.
10. As a T3 Code user, I want a failed queue head to block later queued turns, so that queue order remains meaningful.
11. As a T3 Code user, I want to retry a failed queued turn, so that transient provider errors do not force me to retype instructions.
12. As a T3 Code user, I want to remove a pending or failed queued turn, so that I can unblock the queue or discard stale intent.
13. As a T3 Code user, I do not want to remove a sending queued turn in v1, so that queue dispatch and active turn cancellation remain separate concepts.
14. As a Codex user, I want to Steer an active turn using Codex-native steering, so that I can add guidance without starting a new turn.
15. As a Codex user, I want Steer to use the active turn’s settings, so that steering does not pretend to change model, runtime mode, or interaction mode mid-turn.
16. As a Codex user, I want Steer to support text and terminal context in v1, so that the core same-turn guidance workflow is available.
17. As a Codex user, I want attachments to be queued rather than steered in v1, so that unsupported attachment steering does not fail or behave inconsistently.
18. As a user of a provider without native steering, I want Steer to be visibly unavailable or fall back to Queue, so that my message is still captured.
19. As a T3 Code user, I want a global Follow-Up Behavior setting, so that my default send-while-running behavior matches my preference.
20. As a T3 Code user, I want a one-shot alternate action, so that I can Steer instead of Queue or Queue instead of Steer for a single message.
21. As a keyboard-heavy user, I want a shortcut for the one-shot alternate action, so that I can choose the non-default behavior without leaving the keyboard.
22. As a T3 Code user, I want Steer entries to be visible without looking like new user messages, so that the timeline preserves the distinction between same-turn input and new turns.
23. As a T3 Code user, I want raced or non-steerable Steer attempts to become queued turns with visible feedback, so that my input is not lost.
24. As a T3 Code user, I want fallback-to-queue to be explicit, so that I can understand why a message I intended to steer is queued instead.
25. As a maintainer, I want Queue and Steer represented as orchestration commands/events, so that user intent is observable and recoverable.
26. As a maintainer, I want provider capabilities to declare steer support, so that the UI and server do not guess at provider behavior.
27. As a maintainer, I want Codex `turn/steer` wrapped behind the provider abstraction, so that protocol details stay inside the Codex adapter.
28. As a maintainer, I want tests around queue draining and steer fallback, so that reconnects, races, and provider failures remain predictable.
29. As a maintainer, I want the queued turn foundation to reuse upstream PR #2724, so that we start from an already-tested queue architecture.
30. As a maintainer, I want the feature split into stacked branches, so that queue foundation, native steer, and UI behavior can be reviewed independently.
31. As a maintainer, I want the queued turn foundation merged with minimal modification first, so that upstream queue behavior is reviewed separately from fork-specific enhancements.
32. As a maintainer, I want implementation to proceed in dependency order through Steer orchestration, so that UI work does not race unstable server contracts.

## Implementation Decisions

- Commit the glossary, ADRs, and PRD as a documentation baseline before implementation branches begin.
- Use upstream PR #2724 as the queued turn foundation. It cleanly merges into this fork and already provides durable queued turn orchestration, persistence, queue draining, and tests.
- Merge upstream PR #2724 with minimal modification first. The foundation branch should resolve only conflicts and compatibility/check failures, leaving queued turn removal, Steer, settings, and UI polish for follow-up branches.
- Use a practical stacked branch strategy: documentation baseline, queued turn foundation, queued turn resolution, Follow-Up Behavior core, Follow-Up Behavior UI, and an optional final verification branch.
- Implement in strict dependency order through Steer orchestration: queued turn foundation, queued turn resolution, setting/resolver, provider-native Codex Steer, persisted Steer lifecycle, then UI.
- Keep domain language precise: use Queued Turn in contracts/orchestration code, and queued follow-up only as UI copy.
- Queue remains the default Follow-Up Behavior.
- Add `followUpBehavior: "queue" | "steer"` to client settings with default `"queue"`. Existing users should silently decode missing settings to Queue with no migration prompt.
- Add a one-shot composer alternate behavior instead of a sticky inline composer toggle.
- Add provider steer capability as `turnSteering: "native" | "unsupported"`.
- Codex supports native steering through app-server `turn/steer`; Claude, Cursor, and OpenCode start as unsupported unless a true same-turn steering API is proven.
- Add a provider-level `steerTurn` operation that returns the active turn id rather than a new turn-start result.
- Represent Steer through orchestration commands/events rather than direct UI-to-provider calls.
- Persist requested, accepted, failed, and fallback Steer outcomes.
- Show accepted Steer as a Steer Entry belonging to the active turn, not as a standalone user message.
- Queue supports the full normal turn payload.
- Steer v1 supports steerable input: text plus terminal context, not image/file attachments.
- If Steer is requested with attachments in v1, Queue remains the available behavior.
- If Steer is unsupported by the active provider, the UI visibly falls back to Queue rather than throwing on normal Enter.
- If native Steer races with turn completion or is rejected as non-steerable, server-side Steer Fallback converts the input into a normal queued turn and records an explicit fallback event that links the original Steer attempt to the queued turn.
- A failed queue head blocks later queued turns until retried or removed.
- Add first-class queued turn removal for pending and failed queued turns.
- Do not allow removing sending queued turns in v1.
- Composer owns dense queue management controls; timeline owns lightweight visibility and historical explanation.
- Maintain the package boundary: contracts stay schema-only, shared runtime helpers use explicit subpath exports, and provider-specific protocol mapping stays in provider adapters.

## Testing Decisions

- Tests should assert external behavior and state transitions, not implementation details.
- Contract tests should cover new settings, provider capability shape, queued turn remove commands/events, and steer commands/events.
- Decider/projector tests should cover queue remove, strict queue-head behavior, steer request/accepted/failed/fallback events, and persisted Steer Entries.
- Reactor tests should cover queue drain, failed head blocking, retry/remove unblock behavior, native steer success, and steer fallback-to-queue.
- Provider service and Codex adapter tests should cover `steerTurn`, `expectedTurnId`, unsupported provider failure, and mapping to Codex app-server `turn/steer`.
- Web logic tests should cover follow-up behavior resolution across provider capability, global setting, one-shot override, active turn state, and attachments.
- Browser/component tests should cover send-while-running Queue, supported Steer, unsupported Steer fallback, attachment behavior, retry/remove controls, and visible Steer Entries.
- Required completion checks remain `bun fmt`, `bun lint`, and `bun typecheck`; use `bun run test`, never `bun test`.

## Out of Scope

- Editing or reordering queued turns in v1.
- Removing or cancelling queued turns already in `sending` state.
- Attachment steering in v1.
- Emulating Steer for providers without native same-turn steering.
- Per-thread Follow-Up Behavior settings.
- Provider-specific non-Codex steering until a real native same-turn API is identified.
- Silent fallback behavior that hides Queue/Steer differences from users.

## Further Notes

- Fork Issues are enabled for `AustinKelsay/t3code-local`; this PRD is tracked by issue #5 and the implementation slices by issues #6-#13.
- Upstream references: issue #231 describes accepted Queue/Steer product direction; issue #1462 requests configurable follow-up behavior; PR #1479 is useful design reference; PR #2724 is the preferred queued turn foundation.
