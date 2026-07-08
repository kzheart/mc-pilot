import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ProxyType } from "../download/VersionMatrix.js";
import { MctError } from "../util/errors.js";
import type { ServerType } from "../util/instance-types.js";
import { ensureServerProperties } from "./ServerInstanceManager.js";

export type ForwardingMode = "modern" | "legacy";

export function compareMcVersions(a: string, b: string): number {
  const partsA = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const partsB = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const va = partsA[i] ?? 0;
    const vb = partsB[i] ?? 0;
    if (va < vb) {
      return -1;
    }
    if (va > vb) {
      return 1;
    }
  }

  return 0;
}

export function decideForwardingMode(
  proxyType: ProxyType,
  backendMcVersions: string[],
): ForwardingMode {
  if (proxyType === "bungeecord") {
    return "legacy";
  }

  const allModern = backendMcVersions.every(
    (version) => compareMcVersions(version, "1.13") >= 0,
  );
  return allModern ? "modern" : "legacy";
}

function serializeYamlValue(value: string | number | boolean): string {
  if (typeof value === "string") {
    return `"${value}"`;
  }
  return String(value);
}

function getLineIndent(line: string): number {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

function findBlockEnd(lines: string[], headerIdx: number): number {
  const headerIndent = getLineIndent(lines[headerIdx]);
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      continue;
    }
    if (getLineIndent(line) <= headerIndent) {
      return i;
    }
  }
  return lines.length;
}

function findSectionHeader(
  lines: string[],
  name: string,
  level: number,
  searchStart: number,
  searchEnd: number,
): number {
  const indent = " ".repeat(2 * level);
  for (let i = searchStart; i < searchEnd; i++) {
    const line = lines[i];
    if (!line.startsWith(`${indent}${name}:`)) {
      continue;
    }
    const after = line.slice(indent.length);
    if (
      after === `${name}:` ||
      after.startsWith(`${name}: `) ||
      after.startsWith(`${name}:\t`)
    ) {
      return i;
    }
  }
  return -1;
}

function buildSectionSubtree(
  sectionPath: string[],
  startLevel: number,
  entries: Record<string, string | number | boolean>,
): string[] {
  const result: string[] = [];
  for (let level = startLevel; level < sectionPath.length; level++) {
    result.push(`${" ".repeat(2 * level)}${sectionPath[level]}:`);
  }

  const keyIndent = " ".repeat(2 * sectionPath.length);
  for (const [key, value] of Object.entries(entries)) {
    result.push(`${keyIndent}${key}: ${serializeYamlValue(value)}`);
  }

  return result;
}

function buildFreshYaml(
  sectionPath: string[],
  entries: Record<string, string | number | boolean>,
): string {
  return `${buildSectionSubtree(sectionPath, 0, entries).join("\n")}\n`;
}

function updateSectionEntries(
  lines: string[],
  headerIdx: number,
  sectionPath: string[],
  entries: Record<string, string | number | boolean>,
): void {
  const blockEnd = findBlockEnd(lines, headerIdx);
  const keyIndent = " ".repeat(2 * sectionPath.length);
  const newLines: string[] = [];

  for (const [key, value] of Object.entries(entries)) {
    const newLine = `${keyIndent}${key}: ${serializeYamlValue(value)}`;
    let found = false;

    for (let i = headerIdx + 1; i < blockEnd; i++) {
      const line = lines[i];
      if (line.trim() === "") {
        continue;
      }
      if (!line.startsWith(keyIndent)) {
        continue;
      }
      const rest = line.slice(keyIndent.length);
      if (rest.startsWith(`${key}:`)) {
        lines[i] = newLine;
        found = true;
        break;
      }
    }

    if (!found) {
      newLines.push(newLine);
    }
  }

  if (newLines.length > 0) {
    lines.splice(headerIdx + 1, 0, ...newLines);
  }
}

export async function ensureYamlSection(
  filePath: string,
  sectionPath: string[],
  entries: Record<string, string | number | boolean>,
): Promise<void> {
  let lines: string[] = [];

  try {
    const raw = await readFile(filePath, "utf8");
    if (raw.trim() === "") {
      lines = [];
    } else {
      lines = raw.split(/\r?\n/);
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
    }
  } catch {
    lines = [];
  }

  if (lines.length === 0) {
    await writeFile(filePath, buildFreshYaml(sectionPath, entries), "utf8");
    return;
  }

  let headerIdx = -1;

  for (let level = 0; level < sectionPath.length; level++) {
    const name = sectionPath[level];
    const searchStart = level === 0 ? 0 : headerIdx + 1;
    const searchEnd =
      level === 0 ? lines.length : findBlockEnd(lines, headerIdx);
    const found = findSectionHeader(lines, name, level, searchStart, searchEnd);

    if (found === -1) {
      const insertAt =
        level === 0 ? lines.length : findBlockEnd(lines, headerIdx);
      lines.splice(
        insertAt,
        0,
        ...buildSectionSubtree(sectionPath, level, entries),
      );
      await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
      return;
    }

    headerIdx = found;
  }

  updateSectionEntries(lines, headerIdx, sectionPath, entries);
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

export async function ensureBackendForwarding(
  instanceDir: string,
  backendType: ServerType,
  mcVersion: string,
  mode: ForwardingMode,
  secret: string,
): Promise<string[]> {
  const warnings: string[] = [];

  if (backendType === "vanilla") {
    warnings.push(
      "vanilla backend does not support IP forwarding; player identity will not be forwarded",
    );
    await ensureServerProperties(instanceDir, { "online-mode": "false" });
    return warnings;
  }

  if (backendType === "velocity" || backendType === "bungeecord") {
    throw new MctError(
      { code: "INVALID_PARAMS", message: "Backend cannot be a proxy type" },
      4,
    );
  }

  let effectiveMode = mode;

  if (mode === "modern" && backendType === "spigot") {
    warnings.push(
      "spigot backend does not support Velocity modern forwarding; falling back to legacy (set velocity to legacy mode)",
    );
    effectiveMode = "legacy";
  }

  if (
    effectiveMode === "modern" &&
    (backendType === "paper" || backendType === "purpur")
  ) {
    if (compareMcVersions(mcVersion, "1.19") >= 0) {
      const configDir = path.join(instanceDir, "config");
      await mkdir(configDir, { recursive: true });
      await ensureYamlSection(
        path.join(configDir, "paper-global.yml"),
        ["proxies", "velocity"],
        {
          enabled: true,
          "online-mode": false,
          secret,
        },
      );
    } else if (compareMcVersions(mcVersion, "1.13") >= 0) {
      await ensureYamlSection(
        path.join(instanceDir, "paper.yml"),
        ["settings", "velocity-support"],
        {
          enabled: true,
          "online-mode": false,
          secret,
        },
      );
    }
  }

  if (
    effectiveMode === "legacy" &&
    (backendType === "paper" ||
      backendType === "purpur" ||
      backendType === "spigot")
  ) {
    await ensureYamlSection(
      path.join(instanceDir, "spigot.yml"),
      ["settings"],
      {
        bungeecord: true,
      },
    );
  }

  await ensureServerProperties(instanceDir, { "online-mode": "false" });
  return warnings;
}
