# Local Fork

This repository is a personal fork layered on top of Nick's fork of T3 Code.

The reason this fork exists is simple:

- T3 Code is worth building on.
- Nick's fork already contains changes worth keeping.
- This repo is where local preferences, workflow changes, and new experiments can live without waiting on upstream decisions.

## Fork Lineage

The working chain for this codebase is:

`T3 Code upstream` -> `Nick's fork` -> `t3code-custom`

Each layer has a different role:

- Upstream T3 Code is the main source of broad product direction, bug fixes, and structural improvements.
- Nick's fork is the inherited customization layer that this repo builds on.
- `t3code-custom` is the local layer for opinionated changes that support how this project is actually used day to day.

## What This Document Is For

This file is the local fork policy doc.

It exists to make three things explicit:

- why this fork differs from upstream
- how local changes should be managed
- how to keep the fork maintainable as upstream and inherited changes continue to move

`AGENTS.md` remains the execution contract for task work. This document explains fork intent and fork management.

## Local Fork Priorities

- Keep the parts of T3 Code that already work well.
- Keep the inherited changes from Nick's fork that improve real usage.
- Add local customizations deliberately instead of accumulating random one-off edits.
- Preserve mergeability where practical so upstream improvements remain easy to adopt.
- Favor performance, reliability, and predictable behavior over convenience.

## How Changes Should Be Classified

Every meaningful change in this fork should fit one of these buckets:

- `upstream-sync`: changes pulled in to reduce divergence or pick up upstream fixes
- `inherited-fork`: behavior retained or adapted from Nick's fork
- `local-custom`: changes that exist because this fork has different preferences or workflow needs
- `experimental`: ideas being tested before they are treated as part of the fork's long-term direction

If a change does not clearly fit one of those categories, the change probably is not framed well enough yet.

## Maintenance Rules

- Keep `origin` as this fork. If needed later, add separate remotes for upstream T3 Code and Nick's fork instead of overloading one remote.
- Keep separate remotes for both parent repositories when we start syncing regularly so provenance stays explicit.
- Prefer small, deliberate syncs from upstream instead of large surprise merges.
- Keep local-only behavior isolated in new files, helpers, hooks, or leaf components when possible.
- Avoid expanding upstream/core files when a thin integration point will do.
- Document intentional divergence once it starts affecting maintenance, UX, deployment, or architecture decisions.
- Do not keep complicated local behavior that cannot survive normal upstream updates without repeated pain.

## Sync And Conflict Philosophy

This fork follows the merge-conflict philosophy from Phil Haack's March 25, 2026 post, ["Resolve Merge Conflicts the Easy Way"](https://haacked.com/archive/2026/03/25/resolve-merge-conflicts/).

The practical policy is:

- use better default merge machinery before accepting manual conflict cleanup as normal
- treat repeated conflict work as automation debt
- reserve human judgment for the small set of conflicts that are actually ambiguous
- prefer repeatable conflict resolution over ad hoc one-off fixes during stressful rebases

## Conflict Resolution Rules

When syncing from either parent repo, handle conflicts in layers:

1. Use structural merge tooling where it helps reduce false textual conflicts.
2. Enable reusable Git conflict history so repeated resolutions get replayed automatically.
3. Automate deterministic conflict classes such as generated artifacts and lockfiles.
4. Escalate only genuinely ambiguous conflicts for manual review.

For this fork, that means:

- false conflicts caused by imports, object members, or other syntax-preserving edits should be handled by better merge tooling where possible
- lockfiles should not get hand-merged line by line; they should be regenerated from the resolved manifests
- migrations, protocol changes, or other order-sensitive artifacts should be reviewed deliberately
- duplicate code introduced by stacked branch history should be treated as a category to detect and resolve systematically, not as a surprise every time

## What We Want Operationally

Over time, this fork should move toward a sync workflow where:

- upstream syncs from T3 Code are routine
- inherited syncs from Nick's fork are routine
- conflict handling is assisted by Git configuration and tooling, not just manual effort
- the remaining manual conflicts are understandable and worth human attention

The goal is not to avoid all conflicts. The goal is to avoid wasting attention on conflicts that are mechanical, repetitive, or structurally obvious.

## Decision Rules For New Work

- If a change is broadly useful and low-friction, keep it upstream-friendly.
- If a change is strongly personal or workflow-specific, keep it local and isolate it clearly.
- If a change increases future merge cost, the local benefit should be recurring and obvious.
- If a feature creates hidden operational risk, redesign it before treating it as part of the fork.
- If a divergence becomes important to daily use, document it here or in a focused doc under `docs/`.

## Current Direction

Right now this fork should be treated as:

- a stable place to preserve the best parts of upstream T3 Code
- a stable place to preserve the best parts of Nick's fork
- a controlled layer for local customization
- a living record of why this repo intentionally differs from its parent sources

## Local Remote Access Workflow

For this fork, remote phone access should use the browser/server path over Tailscale, not the Electron desktop app.

The repeatable local command is:

```bash
bun run start:web:tailscale
```

That command is the preferred workflow because it does the exact sequence this fork needs:

1. builds `apps/web`
2. builds `apps/server`
3. binds the server to the current Tailscale IPv4 address
4. generates or uses `T3CODE_AUTH_TOKEN`
5. prints the exact phone URL as `http://<tailnet-ip>:3773/?token=<token>`

Operational rules for this fork:

- use the printed browser URL from your phone while connected to the same Tailnet
- keep the terminal open while the remote session is active
- do not use Electron as the remote access target
- if you need a fixed token or port, set `T3CODE_AUTH_TOKEN` and/or `T3CODE_PORT` before running the command
- if `bun` is missing from `PATH`, run `export PATH="$HOME/.bun/bin:$PATH"` first

## Current Tested Setup

The setup that is currently known-good for this fork is:

- web mode only for remote access
- Tailscale for network access
- a fixed URL shape of `http://<tailnet-ip>:<port>/?token=<token>`
- server state rooted at `T3CODE_HOME`, which defaults to `~/.t3`
- the desktop app kept closed while the remote web session is active

The exact repeatable host recipe is:

```bash
export PATH="$HOME/.bun/bin:$PATH"
export T3CODE_PORT=3773
export T3CODE_AUTH_TOKEN="<long-random-token>"
export T3CODE_HOME="$HOME/.t3"
bun run start:web:tailscale
```

This fork now relies on three implementation details for that flow:

- the launcher script builds `apps/web` first and `apps/server` second before starting the server
- the browser client preserves the remote `token` query parameter across navigation and reloads
- the server serves `index.html` with `Cache-Control: no-store` so mobile Safari does not get stuck on a stale shell

If the phone view looks wrong, the expected recovery step is:

1. close the old Safari tab
2. open a fresh tab or private tab with the full `?token=...` URL
3. tap the mobile sidebar toggle to see existing projects and threads

## How To Use This Doc Going Forward

Update this file when:

- a local customization becomes intentional and long-lived
- a maintenance rule needs to be made explicit
- a divergence from upstream stops being accidental and becomes part of the fork's identity
- a new local workflow changes how the project should be operated or extended

This document should stay short, practical, and current.
