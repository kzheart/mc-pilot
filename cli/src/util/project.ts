import { realpathSync } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ERROR_CODES, ERROR_MESSAGES, MctError } from "./errors.js";

export interface MctProfile {
  /** Single backend server (shorthand for `servers: [name]`). */
  server?: string;
  /** Backend servers; takes precedence over `server` when non-empty. */
  servers?: string[];
  /** Proxy server (velocity/bungeecord) fronting the backends. */
  proxy?: string;
  clients: string[];
}

/** Optional per-server launch overrides, keyed by server name. */
export interface MctServerConfig {
  /** Jar file name inside the server directory (default: auto-detected). */
  jar?: string;
  /** Java executable (default: `java`). */
  java?: string;
  jvmArgs?: string[];
}

export interface MctProjectFile {
  project: string;
  profiles: Record<string, MctProfile>;
  defaultProfile?: string;
  servers?: Record<string, MctServerConfig>;
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
  rootDir: string;
  filePath: string;
  projectFile: MctProjectFile;
}

export const PROJECT_FILE_NAME = "mct.json";

export function normalizeProjectRoot(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

export function resolveProjectFilePath(rootDir: string): string {
  return path.join(rootDir, PROJECT_FILE_NAME);
}

async function loadProjectFileAt(
  rootDir: string,
): Promise<ResolvedProjectConfig | null> {
  const filePath = resolveProjectFilePath(rootDir);
  try {
    await access(filePath);
  } catch {
    return null;
  }

  const raw = await readFile(filePath, "utf8");
  try {
    return {
      rootDir,
      filePath,
      projectFile: JSON.parse(raw) as MctProjectFile,
    };
  } catch (error) {
    throw new MctError(
      {
        code: "INVALID_PROJECT_FILE",
        message: `${filePath} is not valid JSON: ${(error as Error).message}`,
      },
      4,
    );
  }
}

/** Walk up from `cwd` to the nearest directory holding `mct.json`. */
export async function loadProjectFileForCwd(
  cwd: string,
): Promise<ResolvedProjectConfig | null> {
  let current = normalizeProjectRoot(cwd);

  while (true) {
    const resolved = await loadProjectFileAt(current);
    if (resolved) {
      return resolved;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/** Load the project rooted exactly at `dir` (the global `--project` option). */
export async function loadProjectFileForDir(
  dir: string,
  cwd: string,
): Promise<ResolvedProjectConfig> {
  const rootDir = normalizeProjectRoot(path.resolve(cwd, dir));
  const resolved = await loadProjectFileAt(rootDir);
  if (!resolved) {
    throw new MctError(
      {
        code: ERROR_CODES.NO_PROJECT,
        message: `No ${PROJECT_FILE_NAME} found in ${rootDir}`,
      },
      4,
    );
  }
  return resolved;
}

export async function writeProjectFile(
  rootDir: string,
  project: MctProjectFile,
): Promise<void> {
  await writeFile(
    resolveProjectFilePath(rootDir),
    `${JSON.stringify(project, null, 2)}\n`,
    "utf8",
  );
}

export function createDefaultProjectFile(projectName: string): MctProjectFile {
  return {
    project: projectName,
    profiles: {},
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
