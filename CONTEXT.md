# T3 Code

T3 Code is a web interface for coding-agent sessions. Its language centers on projects, threads, turns, and the orchestration state that makes agent work predictable across reconnects and failures.

## Language

**Turn**:
A unit of agent work started from a user message on a **Thread**. A turn may be active, completed, failed, interrupted, or cancelled.
_Avoid_: Run, job, request

**Queued Turn**:
A user message captured while a **Thread** cannot start another turn immediately, intended to become a normal **Turn** when the thread is ready.
_Avoid_: Queued follow-up in domain code, queued message in contracts

**Queue Head**:
The first unresolved **Queued Turn** for a **Thread**. Queue order is meaningful; if the queue head fails, later queued turns wait until the failed head is retried, removed, or moved.
_Avoid_: Next message, latest queued item

**Queue Resolution**:
The user action that unblocks a failed **Queue Head**. The first implementation supports retrying or removing the failed queued turn.
_Avoid_: Queue management, queue editing

**Queued Follow-Up**:
User-facing copy for a **Queued Turn** shown in the composer or thread UI.
_Avoid_: Backend term, contract term

**Steer**:
Additional user input appended to the currently active **Turn**, without starting a new turn. This mirrors Codex app-server `turn/steer` behavior.
_Avoid_: Interrupt-and-restart, queued turn

**Steer Entry**:
A visible record that a **Turn** received steering input. It belongs to the active turn and is not a standalone user message.
_Avoid_: User message, queued turn

**Steerable Input**:
Input that can be appended to an active **Turn** through **Steer**. In the first implementation this is text and terminal context, not image or file attachments.
_Avoid_: Attachment steering

**Follow-Up Behavior**:
The user preference that decides what happens to a message submitted while a **Turn** is active. Queue is the predictable default; Steer is an explicit same-turn intervention when the provider supports it.
_Avoid_: Send mode, delivery mode

**Steer Support**:
A provider capability indicating whether active **Turns** can receive same-turn input. Providers without steer support fall back to **Queued Turns** while clearly showing that Steer is unavailable.
_Avoid_: Emulated steer, interrupt steer

**Steer Fallback**:
The preservation of steer input as a **Queued Turn** when the active turn cannot accept steering. The UI should make this visible instead of silently pretending the steer succeeded.
_Avoid_: Silent queueing, lost steer

## Example Dialogue

Dev: "The user typed another instruction while the thread was running. Is that a queued follow-up?"

Domain expert: "In the UI, yes. In orchestration, call it a queued turn, because it becomes the next turn once the thread is ready."

Dev: "The first queued turn failed, but there are two more queued after it. Should we send those?"

Domain expert: "No. The first item is the queue head, and queue order is meaningful. Resolve the head before draining later turns."

Dev: "How does the user unblock a failed queue head?"

Domain expert: "They resolve it by retrying or removing that queued turn."

Dev: "If the user chooses Steer, should we interrupt the current turn and start over?"

Domain expert: "No. Steer means the active turn receives more input while it is still running. If we need a later turn, that is Queue."

Dev: "What should happen when I press Enter during an active turn?"

Domain expert: "Use the selected follow-up behavior. By default, queue the message; steer only when the user explicitly chooses it and the provider supports it."

Dev: "The user picked Steer globally, but this provider cannot steer. Should Enter fail?"

Domain expert: "No. Capture the message as a queued turn, and make the UI clear that this provider only supports Queue."

Dev: "Codex rejected the steer because the active turn finished right as the user submitted it. Do we drop it?"

Domain expert: "No. Use steer fallback: queue the input and show that the steer became a queued turn."

Dev: "Should steering show up as another user bubble?"

Domain expert: "No. A user bubble starts a new turn. Steering is shown as a steer entry on the active turn."

Dev: "Can I steer an image into a running turn?"

Domain expert: "Not in the first version. Queue supports the full normal turn payload; Steer is limited to steerable input."
