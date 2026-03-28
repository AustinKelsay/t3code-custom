# T3 Code

T3 Code is a minimal web GUI for coding agents (currently Codex and Claude, more coming soon).

This repository is a personal fork. For fork-specific policy, lineage, and operational differences, read [LOCAL_FORK.md](./LOCAL_FORK.md) and [docs/fork-differences.md](./docs/fork-differences.md).

## How to use

> [!WARNING]
> You need to have [Codex CLI](https://github.com/openai/codex) installed and authorized for T3 Code to work.

```bash
npx t3
```

You can also just install the desktop app. It's cooler.

Install the [desktop app from the Releases page](https://github.com/pingdotgg/t3code/releases)

## Some notes

We are very very early in this project. Expect bugs.

We are not accepting contributions yet.

## Git conflict setup

This repo includes a local Git setup command to reduce noisy merge conflicts, especially around `bun.lock`.

```bash
bun run git:setup-merge-tools
```

That command configures this checkout to:

- use `diff3` conflict markers
- enable `rerere`
- treat `bun.lock` as generated and prefer the incoming version during merges
- enable `mergiraf` for all files if it is installed on your `PATH`

After resolving dependency manifest conflicts, regenerate the lockfile with:

```bash
bun run lockfile:refresh
```

## If you REALLY want to contribute still.... read this first

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
