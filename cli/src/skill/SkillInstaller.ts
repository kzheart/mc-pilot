import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_TARGETS = {
  agents: { label: "Agents 标准目录", path: ".agents/skills" },
  codex: { label: "Codex", path: ".codex/skills" },
  claude: { label: "Claude Code", path: ".claude/skills" },
  cursor: { label: "Cursor", path: ".cursor/skills" },
  gemini: { label: "Gemini CLI", path: ".gemini/skills" },
  opencode: { label: "OpenCode", path: ".config/opencode/skills" },
  windsurf: { label: "Windsurf", path: ".codeium/windsurf/skills" },
  copilot: { label: "GitHub Copilot", path: ".copilot/skills" },
} as const;

export type SkillTargetId = keyof typeof SKILL_TARGETS;

interface SkillManifest {
  schemaVersion: 1;
  targets: SkillTargetId[];
  sourceHash: string;
  packageVersion: string;
  updatedAt: string;
}

export interface SkillInstallerOptions {
  homeDir?: string;
  mctHome?: string;
  sourceDir?: string;
  packageVersion?: string;
  force?: boolean;
}

const MANAGED_MARKER = ".mc-pilot-managed.json";

function resolvePackageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function resolveSkillSourceDir() {
  return path.join(resolvePackageRoot(), "skills", "mc-pilot");
}

export function resolveSkillManifestPath(options: SkillInstallerOptions = {}) {
  const mctHome =
    options.mctHome ??
    process.env.MCT_HOME ??
    path.join(options.homeDir ?? os.homedir(), ".mct");
  return path.join(mctHome, "skill-install.json");
}

export function parseSkillTargets(value: string): SkillTargetId[] {
  const normalized = value.trim().toLowerCase();
  if (normalized === "none" || normalized === "") {
    return [];
  }
  if (normalized === "all") {
    return Object.keys(SKILL_TARGETS) as SkillTargetId[];
  }
  const targets = [
    ...new Set(
      normalized
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
  const invalid = targets.filter((entry) => !(entry in SKILL_TARGETS));
  if (invalid.length > 0) {
    throw new Error(
      `未知 Skill 目标: ${invalid.join(", ")}。可选: ${Object.keys(SKILL_TARGETS).join(", ")}`,
    );
  }
  return targets as SkillTargetId[];
}

async function hashDirectory(directory: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(current: string, relative: string) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const childRelative = path.join(relative, entry.name);
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(child, childRelative);
      } else if (entry.isFile()) {
        hash.update(childRelative);
        hash.update(await readFile(child));
      }
    }
  }
  await visit(directory, "");
  return hash.digest("hex");
}

async function readManifest(
  options: SkillInstallerOptions,
): Promise<SkillManifest | undefined> {
  try {
    return JSON.parse(
      await readFile(resolveSkillManifestPath(options), "utf8"),
    ) as SkillManifest;
  } catch {
    return undefined;
  }
}

async function readPackageVersion() {
  const packageJson = JSON.parse(
    await readFile(path.join(resolvePackageRoot(), "package.json"), "utf8"),
  ) as { version: string };
  return packageJson.version;
}

function targetDirectory(homeDir: string, target: SkillTargetId) {
  return path.join(homeDir, SKILL_TARGETS[target].path, "mc-pilot");
}

async function isManagedTarget(directory: string) {
  try {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink()) {
      return false;
    }
    const marker = JSON.parse(
      await readFile(path.join(directory, MANAGED_MARKER), "utf8"),
    ) as { package?: string };
    return marker.package === "@kzheart_/mc-pilot";
  } catch {
    return false;
  }
}

async function installTarget(
  sourceDir: string,
  directory: string,
  sourceHash: string,
  packageVersion: string,
  force: boolean,
) {
  let exists = false;
  try {
    await lstat(directory);
    exists = true;
  } catch {}

  if (exists && !force && !(await isManagedTarget(directory))) {
    return {
      targetDir: directory,
      installed: false,
      conflict: true,
      reason: "目标已存在且不是 mc-pilot 管理的副本",
    };
  }

  await mkdir(path.dirname(directory), { recursive: true });
  const temporary = `${directory}.tmp-${process.pid}-${Date.now()}`;
  await rm(temporary, { recursive: true, force: true });
  await cp(sourceDir, temporary, { recursive: true, force: true });
  await writeFile(
    path.join(temporary, MANAGED_MARKER),
    `${JSON.stringify(
      {
        package: "@kzheart_/mc-pilot",
        packageVersion,
        sourceHash,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  if (exists) {
    await rm(directory, { recursive: true, force: true });
  }
  await rename(temporary, directory);
  return { targetDir: directory, installed: true, conflict: false };
}

export async function installSkills(
  targets: SkillTargetId[],
  options: SkillInstallerOptions = {},
) {
  const homeDir = options.homeDir ?? os.homedir();
  const sourceDir = options.sourceDir ?? resolveSkillSourceDir();
  const sourceHash = await hashDirectory(sourceDir);
  const packageVersion = options.packageVersion ?? (await readPackageVersion());
  const results = [];
  for (const target of targets) {
    results.push({
      target,
      ...(await installTarget(
        sourceDir,
        targetDirectory(homeDir, target),
        sourceHash,
        packageVersion,
        options.force ?? false,
      )),
    });
  }

  const manifest: SkillManifest = {
    schemaVersion: 1,
    targets,
    sourceHash,
    packageVersion,
    updatedAt: new Date().toISOString(),
  };
  const manifestPath = resolveSkillManifestPath(options);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return { manifestPath, sourceHash, packageVersion, targets, results };
}

export async function syncConfiguredSkills(
  options: SkillInstallerOptions = {},
) {
  const manifest = await readManifest(options);
  if (!manifest) {
    return { configured: false, synced: false, targets: [] };
  }
  const sourceDir = options.sourceDir ?? resolveSkillSourceDir();
  const sourceHash = await hashDirectory(sourceDir);
  const homeDir = options.homeDir ?? os.homedir();
  const allManaged = (
    await Promise.all(
      manifest.targets.map((target) =>
        isManagedTarget(targetDirectory(homeDir, target)),
      ),
    )
  ).every(Boolean);
  if (manifest.sourceHash === sourceHash && allManaged) {
    return {
      configured: true,
      synced: false,
      upToDate: true,
      targets: manifest.targets,
    };
  }
  const result = await installSkills(manifest.targets, options);
  return { configured: true, synced: true, ...result };
}

export async function getSkillStatus(options: SkillInstallerOptions = {}) {
  const manifest = await readManifest(options);
  const homeDir = options.homeDir ?? os.homedir();
  const sourceDir = options.sourceDir ?? resolveSkillSourceDir();
  const sourceHash = await hashDirectory(sourceDir);
  const targets = await Promise.all(
    (Object.keys(SKILL_TARGETS) as SkillTargetId[]).map(async (target) => {
      const directory = targetDirectory(homeDir, target);
      return {
        target,
        label: SKILL_TARGETS[target].label,
        directory,
        selected: manifest?.targets.includes(target) ?? false,
        managed: await isManagedTarget(directory),
      };
    }),
  );
  return {
    configured: Boolean(manifest),
    manifestPath: resolveSkillManifestPath(options),
    upToDate: manifest?.sourceHash === sourceHash,
    manifest,
    targets,
  };
}
