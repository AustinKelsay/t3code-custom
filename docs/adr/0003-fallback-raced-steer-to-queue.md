# Fallback raced steer to queue

When same-turn steering cannot be accepted because the active turn changed, completed, or is not steerable, T3 Code will preserve the user's input by converting it into a queued turn and showing that fallback in the UI. This favors predictable input preservation over strict failure semantics, while still avoiding silent behavior changes.
