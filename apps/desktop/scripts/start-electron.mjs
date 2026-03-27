import { spawn } from "node:child_process";

import { desktopDir, resolveElectronSpawnSpec } from "./electron-launcher.mjs";

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const electron = resolveElectronSpawnSpec("dist-electron/main.js");
const child = spawn(electron.command, electron.args, {
  stdio: "ignore",
  cwd: desktopDir,
  env: childEnv,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
