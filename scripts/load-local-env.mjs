#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseEnvValue(rawValue) {
  const trimmedValue = rawValue.trim();

  if (
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
  ) {
    const unwrappedValue = trimmedValue.slice(1, -1);
    if (trimmedValue.startsWith('"')) {
      return unwrappedValue
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
    return unwrappedValue;
  }

  return trimmedValue.replace(/\s+#.*$/, "").trim();
}

function parseEnvFile(content) {
  const parsedEntries = [];

  for (const line of content.split(/\r?\n/u)) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) {
      continue;
    }

    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    parsedEntries.push([key, parseEnvValue(rawValue)]);
  }

  return parsedEntries;
}

export function loadLocalEnv(options = {}) {
  const envFilePaths = [options.envFilePath ?? process.env.T3CODE_ENV_FILE ?? ".env.local"];
  const loadedFiles = [];

  for (const envFilePath of envFilePaths) {
    const resolvedPath = resolve(process.cwd(), envFilePath);
    if (!existsSync(resolvedPath)) {
      continue;
    }

    const content = readFileSync(resolvedPath, "utf8");
    for (const [key, value] of parseEnvFile(content)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    loadedFiles.push(resolvedPath);
  }

  return loadedFiles;
}
