# Fork Differences

This repository has three relevant code lines:

- `upstream/main`: `pingdotgg/t3code`
- `ntheile/main`: Nick's fork, which is the inherited parent for most custom behavior here
- `main`: this fork, `AustinKelsay/t3code-custom`

## Remote Roles

In this checkout, the remotes are intentionally split by role:

- `origin`: `AustinKelsay/t3code-custom`
- `ntheile`: `ntheile/t3code`
- `upstream`: `pingdotgg/t3code`

Keep them separate. Do not repoint one remote to mean something else later.

## What This Fork Inherits From Nick's Fork

`main` already includes the major product changes from `ntheile/main`. The inherited layer is where most of the functional divergence from upstream lives, including:

- remote execution targets and SSH-backed runtime work
- thread notes, diff panel work, and mobile UX adjustments
- realtime voice input and spoken reply/readback flows
- project colors, port forwarding, and related orchestration/runtime plumbing
- Git conflict-resolution helpers and merge-safety workflow improvements

If a behavior exists in both `main` and `ntheile/main`, treat it as inherited unless there is a later local commit that changes it again.

## What This Fork Adds On Top Of Nick's Fork

Relative to `ntheile/main`, this fork currently adds a smaller local layer:

- custom desktop branding and release assets for T3 Code Custom
- local fork policy and ops docs such as [LOCAL_FORK.md](/tmp/t3code-doc-cleanup/LOCAL_FORK.md), [REMOTE.md](/tmp/t3code-doc-cleanup/REMOTE.md), and [docs/local-mac-app.md](/tmp/t3code-doc-cleanup/docs/local-mac-app.md)
- Tailscale-oriented remote access workflow, including `.env.local` loading and the `start:web:tailscale` helper
- remote web access hardening such as token persistence and stale-shell mitigation for Safari
- migration repair and a small set of voice/settings hardening changes needed for this fork's operational path

This local layer should stay small and explicit.

## What Makes This Fork Different From Upstream

Relative to `upstream/main`, this fork is the combination of:

1. the inherited `ntheile/main` feature set
2. the smaller local layer listed above

That means the biggest differences versus upstream are not branding. They are product and workflow changes:

- remote agent and SSH target support
- richer diff, notes, and mobile thread workflows
- realtime voice input and spoken assistant readback
- Tailscale-first remote browser usage for this specific fork
- local merge-safety and fork-maintenance conventions

## Current Policy For New Divergence

When adding more fork-specific behavior:

- prefer new files and thin integration points over broad edits to upstream-heavy files
- document any operational divergence once it changes how the repo is run or maintained
- keep local-only behavior small enough that syncing from `ntheile/main` and `upstream/main` stays routine
- do not land large mixed-scope branches when the same outcome can be shipped as smaller focused changes

## PR #1 Status

PR #1 was closed on March 28, 2026 rather than merged.

Reason:

- it mixed a real secure-context/Tailscale need with a much larger voice-session rewrite
- the branch introduced microphone/session prewarm behavior on page load after prior permission grant
- the branch rewrote persistent `tailscale serve` state on port 443 without cleanup

If any part of that work is still needed, re-land it as smaller focused changes.
