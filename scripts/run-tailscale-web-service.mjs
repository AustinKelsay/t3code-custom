#!/usr/bin/env node

process.env.T3CODE_SKIP_BUILD = "1";

await import("./start-tailscale-web.mjs");
