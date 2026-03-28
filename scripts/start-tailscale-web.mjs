#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

import { loadLocalEnv } from "./load-local-env.mjs";

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

const loadedEnvFiles = loadLocalEnv();
for (const loadedEnvFile of loadedEnvFiles) {
  console.log(`[start:web:tailscale] loaded env from ${loadedEnvFile}`);
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

function readJson(command, args) {
  try {
    return JSON.parse(
      execFileSync(command, args, {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
      }),
    );
  } catch (error) {
    fail(
      error instanceof Error
        ? error.message
        : `failed to read JSON from ${command} ${args.join(" ")}`,
    );
  }
}

const tailscaleStatus = readJson(tailscalePath, ["status", "--json"]);
const certDomain =
  process.env.T3CODE_TAILSCALE_DNS_NAME?.trim() ||
  (Array.isArray(tailscaleStatus.CertDomains)
    ? tailscaleStatus.CertDomains.find(
        (candidate) => typeof candidate === "string" && candidate.trim().length > 0,
      )
    : null) ||
  (typeof tailscaleStatus.Self?.DNSName === "string"
    ? tailscaleStatus.Self.DNSName.replace(/\.$/, "")
    : null);

if (!certDomain) {
  fail(
    "could not determine a Tailscale HTTPS hostname. Ensure MagicDNS and HTTPS are available on this node.",
  );
}

const port = process.env.T3CODE_PORT?.trim() || "3773";
const token = process.env.T3CODE_AUTH_TOKEN?.trim() || randomBytes(24).toString("hex");
const bindHost = process.env.T3CODE_BIND_HOST?.trim() || "127.0.0.1";
const phoneUrl = `https://${certDomain}/?token=${token}`;

runStep("building web bundle", ["run", "--cwd", "apps/web", "build"]);
runStep("building server bundle", ["run", "--cwd", "apps/server", "build"]);
console.log("[start:web:tailscale] configuring private HTTPS via tailscale serve");
const serveTarget = `http://${bindHost}:${port}`;
const serveResult = spawnSync(
  tailscalePath,
  ["serve", "--bg", "--yes", "--https", "443", serveTarget],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

if (serveResult.status !== 0) {
  process.exit(serveResult.status ?? 1);
}

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
    bindHost,
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
