import { realpathSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ERROR_CODES, ERROR_MESSAGES, MctError } from "./errors.js";
import {
  resolveProjectConfigPath,
  resolveProjectScreenshotsDir,
} from "./paths.js";

export interface MctProfile {
  /** Single backend server (legacy field, still supported). */
  server?: string;
  /** Backend servers; takes precedence over `server` when non-empty. */
  servers?: string[];
  /** Proxy instance name (velocity/bungeecord) fronting the backends. */
  proxy?: string;
  clients: string[];
  deployPlugins?: string[];
  /** Plugin JARs deployed to the proxy instance instead of backends. */
  proxyPlugins?: string[];
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

export async function loadProjectFileById(
  projectId: string,
): Promise<MctProjectFile | null> {
  const filePath = resolveProjectFilePath(projectId);

  try {
    await access(filePath);
  } catch {
    return null;
  }

  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as MctProjectFile;
}

export async function loadProjectFileForCwd(
  cwd: string,
): Promise<ResolvedProjectConfig | null> {
  let current = normalizeProjectRoot(cwd);

  while (true) {
    const projectId = slugifyProjectId(current);
    const projectFile = await loadProjectFileById(projectId);
    if (projectFile) {
      return {
        projectId,
        filePath: resolveProjectFilePath(projectId),
        projectFile,
      };
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export async function loadProjectFileForId(
  projectId: string,
): Promise<ResolvedProjectConfig | null> {
  const projectFile = await loadProjectFileById(projectId);
  if (!projectFile) {
    return null;
  }

  return {
    projectId,
    filePath: resolveProjectFilePath(projectId),
    projectFile,
  };
}

export async function writeProjectFile(
  projectId: string,
  project: MctProjectFile,
): Promise<void> {
  const filePath = resolveProjectFilePath(projectId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
}

export function createDefaultProjectFile(
  cwd: string,
  projectName: string,
): MctProjectFile {
  const rootDir = normalizeProjectRoot(cwd);
  const projectId = slugifyProjectId(rootDir);
  return {
    projectId,
    project: projectName,
    rootDir,
    profiles: {},
    screenshot: {
      outputDir: resolveProjectScreenshotsDir(projectId),
    },
    timeout: {
      serverReady: 120,
      clientReady: 60,
      default: 10,
    },
  };
}

export function resolveProfile(
  projectFile: MctProjectFile,
  profileName?: string,
): MctProfile | null {
  const name = profileName ?? projectFile.defaultProfile;
  if (!name) {
    return null;
  }

  return projectFile.profiles[name] ?? null;
}

/**
 * Resolve the profile a command should act on.
 *
 * Always reads `context.activeProfile`, which is derived from the merged global
 * options. Commands must not re-resolve the profile themselves: declaring a
 * local `--profile` option shadowed the root one in commander and silently fell
 * back to `defaultProfile`, so `--profile` was ignored in every position.
 */
export function requireActiveProfile(context: {
  projectFile: MctProjectFile | null;
  activeProfile: MctProfile | null;
  requestedProfile?: string;
}): MctProfile {
  if (context.activeProfile) {
    return context.activeProfile;
  }

  const available = Object.keys(context.projectFile?.profiles ?? {});
  if (context.requestedProfile) {
    throw new MctError(
      {
        code: ERROR_CODES.NO_PROFILE,
        message: `Profile '${context.requestedProfile}' not found in this project`,
        details: { requested: context.requestedProfile, available },
      },
      4,
    );
  }

  throw new MctError(
    {
      code: ERROR_CODES.NO_PROFILE,
      message: ERROR_MESSAGES.NO_PROFILE_SELECTED,
      details: { available },
    },
    4,
  );
}

export function resolveBackendNames(profile: MctProfile): string[] {
  if (profile.servers && profile.servers.length > 0) {
    return profile.servers;
  }
  return profile.server ? [profile.server] : [];
}
