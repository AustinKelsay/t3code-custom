// This file mostly exists so the macOS dev launcher uses the app branding instead of "electron"
import desktopBranding from "../branding.json" with { type: "json" };

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const APP_DISPLAY_NAME = isDevelopment
  ? desktopBranding.devProductName
  : desktopBranding.productName;
const APP_BUNDLE_ID = desktopBranding.bundleId;
const LAUNCHER_VERSION = 1;

const __dirname = dirname(fileURLToPath(import.meta.url));
export const desktopDir = resolve(__dirname, "..");

function resolveElectronCliShim() {
  const candidates = [
    join(desktopDir, "node_modules", ".bin", "electron"),
    resolve(desktopDir, "..", "..", "node_modules", ".bin", "electron"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function setPlistString(plistPath, key, value) {
  const replaceResult = spawnSync("plutil", ["-replace", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = spawnSync("plutil", ["-insert", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function patchMainBundleInfoPlist(appBundlePath, iconPath) {
  const infoPlistPath = join(appBundlePath, "Contents", "Info.plist");
  setPlistString(infoPlistPath, "CFBundleDisplayName", APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, "CFBundleName", APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, "CFBundleIdentifier", APP_BUNDLE_ID);
  setPlistString(infoPlistPath, "CFBundleIconFile", "icon.icns");

  const resourcesDir = join(appBundlePath, "Contents", "Resources");
  copyFileSync(iconPath, join(resourcesDir, "icon.icns"));
  copyFileSync(iconPath, join(resourcesDir, "electron.icns"));
}

function patchHelperBundleInfoPlists(appBundlePath) {
  const frameworksDir = join(appBundlePath, "Contents", "Frameworks");
  if (!existsSync(frameworksDir)) {
    return;
  }

  for (const entry of readdirSync(frameworksDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith(".app")) {
      continue;
    }
    if (!entry.name.startsWith("Electron Helper")) {
      continue;
    }

    const helperPlistPath = join(frameworksDir, entry.name, "Contents", "Info.plist");
    if (!existsSync(helperPlistPath)) {
      continue;
    }

    const suffix = entry.name.replace("Electron Helper", "").replace(".app", "").trim();
    const helperName = suffix
      ? `${APP_DISPLAY_NAME} Helper ${suffix}`
      : `${APP_DISPLAY_NAME} Helper`;
    const helperIdSuffix = suffix.replace(/[()]/g, "").trim().toLowerCase().replace(/\s+/g, "-");
    const helperBundleId = helperIdSuffix
      ? `${APP_BUNDLE_ID}.helper.${helperIdSuffix}`
      : `${APP_BUNDLE_ID}.helper`;

    setPlistString(helperPlistPath, "CFBundleDisplayName", helperName);
    setPlistString(helperPlistPath, "CFBundleName", helperName);
    setPlistString(helperPlistPath, "CFBundleIdentifier", helperBundleId);
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function buildMacLauncher(electronBinaryPath) {
  const sourceAppBundlePath = resolve(electronBinaryPath, "../../..");
  const runtimeDir = join(desktopDir, ".electron-runtime");
  const targetAppBundlePath = join(runtimeDir, `${APP_DISPLAY_NAME}.app`);
  const targetBinaryPath = join(targetAppBundlePath, "Contents", "MacOS", "Electron");
  const iconPath = join(desktopDir, "resources", "icon.icns");
  const metadataPath = join(runtimeDir, "metadata.json");

  mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    launcherVersion: LAUNCHER_VERSION,
    sourceAppBundlePath,
    sourceAppMtimeMs: statSync(sourceAppBundlePath).mtimeMs,
    iconMtimeMs: statSync(iconPath).mtimeMs,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    existsSync(targetBinaryPath) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    return targetBinaryPath;
  }

  rmSync(targetAppBundlePath, { recursive: true, force: true });
  cpSync(sourceAppBundlePath, targetAppBundlePath, { recursive: true });
  patchMainBundleInfoPlist(targetAppBundlePath, iconPath);
  patchHelperBundleInfoPlists(targetAppBundlePath);
  writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);

  return targetBinaryPath;
}

function resolveChromeSandboxPath(electronBinaryPath) {
  return join(dirname(electronBinaryPath), "chrome-sandbox");
}

function hasValidChromeSandboxPermissions(electronBinaryPath) {
  try {
    const stats = statSync(resolveChromeSandboxPath(electronBinaryPath));
    const isOwnedByRoot = stats.uid === 0;
    const hasSetuidBit = (stats.mode & 0o4000) === 0o4000;
    const permissions = stats.mode & 0o7777;
    return isOwnedByRoot && hasSetuidBit && permissions === 0o4755;
  } catch {
    return false;
  }
}

function shouldDisableElectronSandbox(electronBinaryPath) {
  const override = process.env.T3CODE_ELECTRON_SANDBOX?.trim().toLowerCase();
  if (override === "off" || override === "false" || override === "0") {
    return true;
  }
  if (override === "on" || override === "true" || override === "1") {
    return false;
  }

  if (process.platform !== "linux") {
    return false;
  }

  return !hasValidChromeSandboxPermissions(electronBinaryPath);
}

function commandExists(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function shouldUseXvfbRun() {
  if (process.platform !== "linux") {
    return false;
  }

  const hasDisplay =
    Boolean(process.env.DISPLAY?.trim()) || Boolean(process.env.WAYLAND_DISPLAY?.trim());
  if (hasDisplay) {
    return false;
  }

  return commandExists("xvfb-run");
}

export function resolveElectronPath() {
  const require = createRequire(import.meta.url);
  let electronBinaryPath;
  try {
    electronBinaryPath = require("electron");
  } catch (error) {
    const shimPath = resolveElectronCliShim();
    if (!shimPath) {
      throw error;
    }
    return shimPath;
  }

  if (process.platform !== "darwin") {
    return electronBinaryPath;
  }

  return buildMacLauncher(electronBinaryPath);
}

export function resolveElectronLaunchArgs(...appArgs) {
  const electronPath = resolveElectronPath();
  return shouldDisableElectronSandbox(electronPath) ? ["--no-sandbox", ...appArgs] : appArgs;
}

export function resolveElectronSpawnSpec(...appArgs) {
  const electronPath = resolveElectronPath();
  const electronArgs = resolveElectronLaunchArgs(...appArgs);

  if (shouldUseXvfbRun()) {
    return {
      command: "xvfb-run",
      args: ["-a", electronPath, ...electronArgs],
    };
  }

  return {
    command: electronPath,
    args: electronArgs,
  };
}
