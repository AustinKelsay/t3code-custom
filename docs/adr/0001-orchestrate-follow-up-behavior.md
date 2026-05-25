# Orchestrate follow-up behavior

T3 Code represents both queued turns and same-turn steering as orchestration commands/events rather than direct UI-to-provider calls. Steer requests, accepted steer entries, failures, and queue fallbacks are persisted so reconnects and debugging can reconstruct what happened. This keeps user intent durable, observable, and recoverable across reconnects and provider failures, at the cost of adding explicit contracts and reactor handling for provider-specific behavior.
