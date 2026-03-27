#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

function fail(message) {
  console.error(`[start:web:tailscale] ${message}`);
  process.exit(1);
}

function resolveCommandPath(command, fallbackPath) {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return command;
  } catch {
    if (fallbackPath && existsSync(fallbackPath)) {
      return fallbackPath;
    }
    return null;
  }
}

const bunPath = resolveCommandPath("bun", `${homedir()}/.bun/bin/bun`);
if (!bunPath) {
  fail("bun was not found on PATH or at ~/.bun/bin/bun");
}

const tailscalePath = resolveCommandPath("tailscale");
if (!tailscalePath) {
  fail("tailscale CLI was not found on PATH");
}

function runStep(label, args) {
  console.log(`[start:web:tailscale] ${label}`);
  const result = spawnSync(bunPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const tailscaleIp =
  process.env.T3CODE_TAILSCALE_IP?.trim() ||
  execFileSync(tailscalePath, ["ip", "-4"], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  })
    .trim()
    .split(/\s+/)[0];

if (!tailscaleIp) {
  fail("could not determine a Tailscale IPv4 address");
}

const port = process.env.T3CODE_PORT?.trim() || "3773";
const token = process.env.T3CODE_AUTH_TOKEN?.trim() || randomBytes(24).toString("hex");
const phoneUrl = `http://${tailscaleIp}:${port}/?token=${token}`;

runStep("building web bundle", ["run", "--cwd", "apps/web", "build"]);
runStep("building server bundle", ["run", "--cwd", "apps/server", "build"]);

console.log(`[start:web:tailscale] phone URL: ${phoneUrl}`);
console.log("[start:web:tailscale] keep this terminal open while the server is running");

const child = spawn(
  bunPath,
  [
    "run",
    "--cwd",
    "apps/server",
    "start",
    "--",
    "--host",
    tailscaleIp,
    "--port",
    port,
    "--auth-token",
    token,
    "--no-browser",
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
