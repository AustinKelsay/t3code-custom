# Local Mac App Workflow

This document is the local-only workflow for running T3 Code Custom as a real macOS app on an Apple Silicon machine.

The goal is a first-class native app experience without depending on GitHub Releases, CI, or any hosted deployment flow.

## What This Covers

- running the desktop app locally during development
- building an installable macOS app artifact for Apple Silicon
- installing it into `/Applications`
- updating it later with new local builds
- customizing the app icon so the installed app looks like your fork

## Prerequisites

- Apple Silicon Mac
- Bun installed
- Node available
- desktop dependencies installed in this repo

If `bun` is not on `PATH` in your shell, use:

```bash
export PATH="$HOME/.bun/bin:$PATH"
```

## 1. Run The Desktop App In Dev Mode

Use this when actively developing:

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/plebdev/Desktop/code/t3code-custom
bun install
bun run dev:desktop
```

That launches the Electron desktop shell plus the local web app in development mode.

Notes:

- this is the fastest loop for day-to-day work
- dev mode is not the same as an installed packaged app
- automatic updates are not relevant in dev mode

## 2. Build A Packaged Native App For Apple Silicon

Use this to create a real installable `.dmg` for this Mac:

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/plebdev/Desktop/code/t3code-custom
bun install
bun run dist:desktop:dmg:arm64
```

Expected output:

- a `.dmg` in the repo `release/` directory
- file name format similar to `T3-Code-<version>-arm64.dmg`

This is the correct build path for an Apple Silicon machine.

## 3. Install It Like A Normal Mac App

After the DMG is built:

1. Open the `.dmg` from the `release/` directory.
2. Drag the app into `/Applications`.
3. Launch it from Spotlight, Launchpad, Finder, or the Dock.
4. Pin it to the Dock if you want the app to feel permanent.

Once installed, it behaves like a normal packaged macOS app instead of a dev-only Electron process.

## 4. Update It Later, Purely Locally

Local packaged builds do not automatically update themselves unless you also publish update metadata to a feed that `electron-updater` can consume.

For a pure local workflow, updates are manual and simple:

1. Pull or make code changes.
2. Rebuild the arm64 DMG:

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/plebdev/Desktop/code/t3code-custom
bun run dist:desktop:dmg:arm64
```

3. Open the newly built DMG.
4. Replace the existing app in `/Applications`.

That is the local update flow.

As long as the bundle identifier and app name stay consistent, macOS will treat this as the same app being replaced by a newer local build.

## 5. Custom Icon Locations

There are two icon paths that matter:

### Dev desktop icon

These files affect the local Electron desktop shell:

- [apps/desktop/resources/icon.icns](/Users/plebdev/Desktop/code/t3code-custom/apps/desktop/resources/icon.icns)
- [apps/desktop/resources/icon.png](/Users/plebdev/Desktop/code/t3code-custom/apps/desktop/resources/icon.png)
- [apps/desktop/resources/icon.ico](/Users/plebdev/Desktop/code/t3code-custom/apps/desktop/resources/icon.ico)

### Packaged production icon

These assets are used when building the installed desktop app:

- [assets/prod/t3code-custom-macos-1024.png](/Users/plebdev/Desktop/code/t3code-custom/assets/prod/t3code-custom-macos-1024.png)
- [assets/prod/t3code-custom-universal-1024.png](/Users/plebdev/Desktop/code/t3code-custom/assets/prod/t3code-custom-universal-1024.png)
- [assets/prod/t3-black-windows.ico](/Users/plebdev/Desktop/code/t3code-custom/assets/prod/t3-black-windows.ico)

The packaged mac app icon is generated from the production mac PNG during the artifact build.

If you want your fork branding to feel consistent everywhere, update both:

- `apps/desktop/resources/*`
- `assets/prod/*`

## 6. Recommended Local-First Routine

For daily work:

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/plebdev/Desktop/code/t3code-custom
bun run dev:desktop
```

For a polished installed app:

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/plebdev/Desktop/code/t3code-custom
bun run dist:desktop:dmg:arm64
```

Then install or replace the app in `/Applications`.

## 7. Operational Notes

- Keep the installed app build local unless you intentionally want release/update infrastructure.
- Treat `dev:desktop` as the fast inner loop and the DMG build as the polished outer loop.
- If the Dock icon does not refresh after replacing the app, quit the app fully and relaunch it.
- If macOS caches the old icon aggressively, remove the app from the Dock and add it again after reinstalling.

## 8. Future Upgrade Path

If later you want true in-app automatic updates for this fork, add a release feed and publish update metadata for the packaged app.

Until then, rebuilding the DMG and replacing the app in `/Applications` is the correct local-first workflow.
