import { realpathSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveProjectConfigPath, resolveProjectScreenshotsDir } from "./paths.js";

export interface MctProfile {
  server: string;
  clients: string[];
  deployPlugins?: string[];
}

export interface MctProjectFile {
  projectId: string;
  project: string;
  rootDir: string;
  profiles: Record<string, MctProfile>;
  defaultProfile?: string;
  screenshot?: {
    outputDir: string;
  };
  timeout?: {
    serverReady?: number;
    clientReady?: number;
    default?: number;
  };
}

export interface ResolvedProjectConfig {
  projectId: string;
  filePath: string;
  projectFile: MctProjectFile;
}

export const PROJECT_FILE_NAME = "project.json";

export function normalizeProjectRoot(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

export function slugifyProjectId(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");
}

export function resolveProjectFilePath(projectId: string): string {
  return resolveProjectConfigPath(projectId);
}

export async function loadProjectFileById(projectId: string): Promise<MctProjectFile | null> {
  const filePath = resolveProjectFilePath(projectId);

  try {
    await access(filePath);
  } catch {
    return null;
  }

  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as MctProjectFile;
}

export async function loadProjectFileForCwd(cwd: string): Promise<ResolvedProjectConfig | null> {
  const projectId = slugifyProjectId(normalizeProjectRoot(cwd));
  const projectFile = await loadProjectFileById(projectId);
  if (!projectFile) {
    return null;
  }

  return {
    projectId,
    filePath: resolveProjectFilePath(projectId),
    projectFile
  };
}

export async function loadProjectFileForId(projectId: string): Promise<ResolvedProjectConfig | null> {
  const projectFile = await loadProjectFileById(projectId);
  if (!projectFile) {
    return null;
  }

  return {
    projectId,
    filePath: resolveProjectFilePath(projectId),
    projectFile
  };
}

export async function writeProjectFile(projectId: string, project: MctProjectFile): Promise<void> {
  const filePath = resolveProjectFilePath(projectId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
}

export function createDefaultProjectFile(cwd: string, projectName: string): MctProjectFile {
  const rootDir = normalizeProjectRoot(cwd);
  const projectId = slugifyProjectId(rootDir);
  return {
    projectId,
    project: projectName,
    rootDir,
    profiles: {},
    screenshot: {
      outputDir: resolveProjectScreenshotsDir(projectId)
    },
    timeout: {
      serverReady: 120,
      clientReady: 60,
      default: 10
    }
  };
}

export function resolveProfile(
  projectFile: MctProjectFile,
  profileName?: string
): MctProfile | null {
  const name = profileName ?? projectFile.defaultProfile;
  if (!name) {
    return null;
  }

  return projectFile.profiles[name] ?? null;
}
