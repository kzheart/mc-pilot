import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface MctProfile {
  server: string;
  clients: string[];
  deployPlugins?: string[];
}

export interface MctProjectFile {
  project: string;
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

export const PROJECT_FILE_NAME = "mct.project.json";

export function resolveProjectFilePath(cwd: string): string {
  return path.join(cwd, PROJECT_FILE_NAME);
}

export async function loadProjectFile(cwd: string): Promise<MctProjectFile | null> {
  const filePath = resolveProjectFilePath(cwd);

  try {
    await access(filePath);
  } catch {
    return null;
  }

  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as MctProjectFile;
}

export async function writeProjectFile(cwd: string, project: MctProjectFile): Promise<void> {
  const filePath = resolveProjectFilePath(cwd);
  await writeFile(filePath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
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
