# Use PR 2724 as queued turn foundation

T3 Code will start the follow-up behavior work by merging upstream PR #2724's queued turn orchestration rather than reimplementing queueing from scratch. The branch cleanly merges into this fork and already provides durable queued turns, queue draining, persistence, and tests, while Steer and product settings will be layered on top.
