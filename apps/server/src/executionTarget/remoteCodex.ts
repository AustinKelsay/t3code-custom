import { runProcess, type ProcessRunResult } from "../processRunner";
import { buildSshCommand, shellQuote, type SshConnectionSpec } from "./ssh";

const REMOTE_CODEX_RESOLUTION_TIMEOUT_MS = 10_000;
const REMOTE_CODEX_RESOLUTION_MAX_BUFFER_BYTES = 32 * 1024;
const COMMON_REMOTE_CODEX_PATHS = [
  "$HOME/.npm-global/bin/codex",
  "$HOME/.local/bin/codex",
  "$HOME/.bun/bin/codex",
  "/usr/local/bin/codex",
  "/usr/bin/codex",
] as const;

function buildRemoteCodexResolveSnippet(binaryPath?: string): string {
  if (binaryPath && binaryPath.includes("/")) {
    return [
      `if [ -x ${shellQuote(binaryPath)} ]; then`,
      `  printf '%s\\n' ${shellQuote(binaryPath)}`,
      "  exit 0",
      "fi",
      "exit 1",
    ].join("\n");
  }

  if (binaryPath) {
    return [
      `if command -v ${shellQuote(binaryPath)} >/dev/null 2>&1; then`,
      `  command -v ${shellQuote(binaryPath)}`,
      "  exit 0",
      "fi",
      "exit 1",
    ].join("\n");
  }

  return [
    "if command -v codex >/dev/null 2>&1; then",
    "  command -v codex",
    "  exit 0",
    "fi",
    ...COMMON_REMOTE_CODEX_PATHS.flatMap((candidate) => [
      `if [ -x "${candidate}" ]; then`,
      `  printf '%s\\n' "${candidate}"`,
      "  exit 0",
      "fi",
    ]),
    "exit 1",
  ].join("\n");
}

export function buildRemoteCodexProbeCommand(binaryPath: string): string {
  return binaryPath.includes("/")
    ? `[ -x ${shellQuote(binaryPath)} ]`
    : `command -v ${shellQuote(binaryPath)} >/dev/null 2>&1`;
}

export function buildRemoteCodexResolveCommand(binaryPath?: string): string {
  const resolveSnippet = buildRemoteCodexResolveSnippet(binaryPath);
  const quotedResolveSnippet = shellQuote(resolveSnippet);

  return [
    'for candidate in "${SHELL:-}" "$(command -v zsh 2>/dev/null)" "$(command -v bash 2>/dev/null)" sh; do',
    '  [ -n "$candidate" ] || continue',
    '  case "${candidate##*/}" in',
    "    bash|zsh)",
    `      output="$("$candidate" -ilc ${quotedResolveSnippet} 2>/dev/null)"`,
    "      status=$?",
    '      if [ "$status" -eq 0 ] && [ -n "$output" ]; then',
    '        printf "%s\\n" "$output"',
    "        exit 0",
    "      fi",
    "      ;;",
    "    sh|dash|ash)",
    `      output="$("$candidate" -lc ${quotedResolveSnippet} 2>/dev/null)"`,
    "      status=$?",
    '      if [ "$status" -eq 0 ] && [ -n "$output" ]; then',
    '        printf "%s\\n" "$output"',
    "        exit 0",
    "      fi",
    "      ;;",
    "  esac",
    "done",
    `output="$(sh -lc ${quotedResolveSnippet} 2>/dev/null)"`,
    "status=$?",
    'if [ "$status" -eq 0 ] && [ -n "$output" ]; then',
    '  printf "%s\\n" "$output"',
    "  exit 0",
    "fi",
    "exit 1",
  ].join("\n");
}

export function buildRemoteCodexShellCommand(input: {
  readonly binaryPath: string;
  readonly cwd?: string;
  readonly homePath?: string;
  readonly args: ReadonlyArray<string>;
}): string {
  const remoteCommand = [input.binaryPath, ...input.args].map(shellQuote).join(" ");
  const remoteScriptParts: string[] = [];

  if (input.cwd !== undefined) {
    remoteScriptParts.push(`cd ${shellQuote(input.cwd)}`);
  }
  if (input.homePath !== undefined) {
    remoteScriptParts.push(`export CODEX_HOME=${shellQuote(input.homePath)}`);
  }
  remoteScriptParts.push(`exec ${remoteCommand}`);

  const remoteScript = remoteScriptParts.join(" && ");
  const probeCommand = buildRemoteCodexProbeCommand(input.binaryPath);
  const quotedRemoteScript = shellQuote(remoteScript);
  const quotedProbeCommand = shellQuote(probeCommand);

  return [
    'for candidate in "${SHELL:-}" "$(command -v zsh 2>/dev/null)" "$(command -v bash 2>/dev/null)" sh; do',
    '  [ -n "$candidate" ] || continue',
    '  case "${candidate##*/}" in',
    "    bash|zsh)",
    `      if "$candidate" -ilc ${quotedProbeCommand}; then`,
    `        exec "$candidate" -ilc ${quotedRemoteScript}`,
    "      fi",
    "      ;;",
    "    sh|dash|ash)",
    `      if "$candidate" -lc ${quotedProbeCommand}; then`,
    `        exec "$candidate" -lc ${quotedRemoteScript}`,
    "      fi",
    "      ;;",
    "  esac",
    "done",
    `exec sh -lc ${quotedRemoteScript}`,
  ].join("\n");
}

function formatRemoteCodexResolutionError(input: {
  readonly targetLabel: string;
  readonly binaryPath?: string;
  readonly result?: ProcessRunResult;
}): Error {
  if (input.result?.timedOut) {
    return new Error(`Timed out while resolving Codex CLI on target '${input.targetLabel}'.`);
  }

  const stderr = input.result?.stderr.trim();
  if (stderr) {
    return new Error(stderr);
  }

  if (input.binaryPath) {
    return new Error(
      `Codex CLI (${input.binaryPath}) is not installed or not executable on target '${input.targetLabel}'.`,
    );
  }

  return new Error(
    `Codex CLI could not be found on target '${input.targetLabel}'. Install codex there or set the target's Codex binary path in Settings.`,
  );
}

export async function resolveRemoteCodexLaunchOptions(input: {
  readonly targetLabel: string;
  readonly connection: SshConnectionSpec;
  readonly binaryPath?: string;
  readonly homePath?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly run?: (
    command: string,
    args: ReadonlyArray<string>,
    options: Parameters<typeof runProcess>[2],
  ) => Promise<ProcessRunResult>;
}): Promise<{
  readonly binaryPath: string;
  readonly homePath?: string;
}> {
  const sshCommand = buildSshCommand({
    connection: input.connection,
    remoteScript: buildRemoteCodexResolveCommand(input.binaryPath),
    ...(input.env ? { env: input.env } : {}),
  });
  const run = input.run ?? runProcess;
  const result = await run(sshCommand.command, sshCommand.args, {
    env: sshCommand.env,
    timeoutMs: input.timeoutMs ?? REMOTE_CODEX_RESOLUTION_TIMEOUT_MS,
    allowNonZeroExit: true,
    maxBufferBytes: REMOTE_CODEX_RESOLUTION_MAX_BUFFER_BYTES,
    outputMode: "truncate",
  });

  if (result.code !== 0) {
    throw formatRemoteCodexResolutionError({
      targetLabel: input.targetLabel,
      ...(input.binaryPath ? { binaryPath: input.binaryPath } : {}),
      result,
    });
  }

  const resolvedBinaryPath = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!resolvedBinaryPath) {
    throw formatRemoteCodexResolutionError({
      targetLabel: input.targetLabel,
      ...(input.binaryPath ? { binaryPath: input.binaryPath } : {}),
      result,
    });
  }

  return {
    binaryPath: resolvedBinaryPath,
    ...(input.homePath ? { homePath: input.homePath } : {}),
  };
}
