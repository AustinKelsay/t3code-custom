import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const MANAGED_BLOCK_START = "# >>> t3code merge setup >>>";
const MANAGED_BLOCK_END = "# <<< t3code merge setup <<<";

function runGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
}

function commandExists(command: string, cwd: string): boolean {
  try {
    execFileSync("sh", ["-lc", `command -v ${command}`], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function setLocalGitConfig(cwd: string, key: string, value: string): void {
  execFileSync("git", ["config", "--local", key, value], {
    cwd,
    stdio: "inherit",
  });
}

function upsertManagedBlock(existing: string, block: string): string {
  const trimmedBlock = `${MANAGED_BLOCK_START}\n${block}\n${MANAGED_BLOCK_END}`;
  const managedPattern = new RegExp(
    `${MANAGED_BLOCK_START}[\\s\\S]*?${MANAGED_BLOCK_END}\\n?`,
    "m",
  );

  if (managedPattern.test(existing)) {
    return existing.replace(managedPattern, `${trimmedBlock}\n`);
  }

  if (existing.trim().length === 0) {
    return `${trimmedBlock}\n`;
  }

  return `${existing.replace(/\s*$/, "\n")}\n${trimmedBlock}\n`;
}

function main(): void {
  const repoRoot = runGit(["rev-parse", "--show-toplevel"], process.cwd());
  const gitDir = runGit(["rev-parse", "--git-dir"], repoRoot);
  const infoAttributesPath = resolve(repoRoot, gitDir, "info", "attributes");
  const bunLockDriverPath = resolve(repoRoot, "scripts", "git-merge-bun-lock.sh");
  const hasMergiraf = commandExists("mergiraf", repoRoot);

  setLocalGitConfig(repoRoot, "merge.conflictstyle", "diff3");
  setLocalGitConfig(repoRoot, "rerere.enabled", "true");
  setLocalGitConfig(repoRoot, "merge.t3-bun-lock.name", "t3 bun.lock merge driver");
  setLocalGitConfig(repoRoot, "merge.t3-bun-lock.driver", `/bin/sh ${bunLockDriverPath} %O %A %B`);

  if (hasMergiraf) {
    setLocalGitConfig(repoRoot, "merge.mergiraf.name", "mergiraf");
    setLocalGitConfig(
      repoRoot,
      "merge.mergiraf.driver",
      "mergiraf merge --git %O %A %B -s %S -x %X -y %Y -p %P -l %L",
    );
  }

  const attributesDir = dirname(infoAttributesPath);
  mkdirSync(attributesDir, { recursive: true });
  const existingAttributes = existsSync(infoAttributesPath)
    ? readFileSync(infoAttributesPath, "utf8")
    : "";

  const blockLines = ["bun.lock merge=t3-bun-lock"];
  if (hasMergiraf) {
    blockLines.unshift("* merge=mergiraf");
  }

  writeFileSync(
    infoAttributesPath,
    upsertManagedBlock(existingAttributes, blockLines.join("\n")),
    "utf8",
  );

  console.log(`Configured local Git conflict-resolution helpers for ${repoRoot}`);
  console.log(`- diff3 conflict style enabled`);
  console.log(`- rerere enabled`);
  console.log(`- bun.lock merge driver enabled`);
  if (hasMergiraf) {
    console.log(`- mergiraf enabled for all files via ${infoAttributesPath}`);
  } else {
    console.log(`- mergiraf not found on PATH; skipping structural merge driver`);
    console.log(`  Install mergiraf and rerun this script to enable it for this checkout.`);
  }
  console.log(`- refresh bun.lock after dependency merges with: bun run lockfile:refresh`);
}

main();
