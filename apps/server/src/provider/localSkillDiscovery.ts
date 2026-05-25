import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import type { ServerProviderSkill } from "@t3tools/contracts";

function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_:]+/g)
    .filter((part) => part.length > 0)
    .map((part) =>
      part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

function frontmatterDescription(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") {
    return undefined;
  }
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end <= 0) {
    return undefined;
  }
  const match = /^description:\s*(.*)$/m.exec(lines.slice(1, end).join("\n"));
  const raw = match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  return raw && raw.length > 0 ? raw : undefined;
}

function firstMarkdownParagraph(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const start =
    lines[0] === "---" ? lines.findIndex((line, index) => index > 0 && line === "---") + 1 : 0;
  const paragraph = lines
    .slice(Math.max(start, 0))
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith("#"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return paragraph.length > 0 ? paragraph : undefined;
}

function readSkillDescription(skillPath: string): string | undefined {
  try {
    const markdown = NodeFs.readFileSync(skillPath, "utf8");
    return frontmatterDescription(markdown) ?? firstMarkdownParagraph(markdown);
  } catch {
    return undefined;
  }
}

export function discoverLocalProviderSkills(root: string): ReadonlyArray<ServerProviderSkill> {
  if (!NodeFs.existsSync(root)) {
    return [];
  }

  return NodeFs.readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink()),
    )
    .flatMap((entry) => {
      const skillPath = NodePath.join(root, entry.name, "SKILL.md");
      if (!NodeFs.existsSync(skillPath)) {
        return [];
      }

      const description = readSkillDescription(skillPath);
      const displayName = titleCaseSlug(entry.name);
      return [
        {
          name: entry.name,
          path: skillPath,
          enabled: true,
          scope: "user",
          displayName,
          ...(description ? { description, shortDescription: description } : {}),
        } satisfies ServerProviderSkill,
      ];
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function discoverCursorSkills(): ReadonlyArray<ServerProviderSkill> {
  return discoverLocalProviderSkills(NodePath.join(NodeOs.homedir(), ".cursor", "skills-cursor"));
}

export function discoverOpenCodeSkills(): ReadonlyArray<ServerProviderSkill> {
  return discoverLocalProviderSkills(
    NodePath.join(NodeOs.homedir(), ".config", "opencode", "skills"),
  );
}
