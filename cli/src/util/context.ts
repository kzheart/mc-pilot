import process from "node:process";

import { GlobalStateStore } from "./global-state.js";
import type { OutputMode } from "./output.js";
import {
  loadProjectFileForCwd,
  loadProjectFileForDir,
  resolveProfile,
  type MctProfile,
  type MctProjectFile,
} from "./project.js";

export interface GlobalOptions {
  human?: boolean;
  client?: string;
  project?: string;
  profile?: string;
}

export interface CommandContext {
  cwd: string;
  outputMode: OutputMode;
  globalState: GlobalStateStore;
  projectFile: MctProjectFile | null;
  activeProfile: MctProfile | null;
  /** Name of the profile actually in effect, for echoing back to the caller. */
  activeProfileName: string | null;
  projectName: string | null;
  projectRootDir: string | null;
  projectConfigPath: string | null;
  timeout(key: "serverReady" | "clientReady" | "default"): number;
}

const TIMEOUT_DEFAULTS = {
  serverReady: 120,
  clientReady: 60,
  default: 10,
};

export async function createCommandContext(
  options: GlobalOptions,
): Promise<CommandContext> {
  const cwd = process.cwd();
  const globalState = new GlobalStateStore();
  const resolvedProject = options.project
    ? await loadProjectFileForDir(options.project, cwd)
    : await loadProjectFileForCwd(cwd);
  const projectFile = resolvedProject?.projectFile ?? null;

  const activeProfileName =
    options.profile ?? projectFile?.defaultProfile ?? null;
  const activeProfile = projectFile
    ? resolveProfile(projectFile, options.profile)
    : null;

  return {
    cwd,
    outputMode: options.human ? "human" : "json",
    globalState,
    projectFile,
    activeProfile,
    activeProfileName: activeProfile ? activeProfileName : null,
    projectName: projectFile?.project ?? null,
    projectRootDir: resolvedProject?.rootDir ?? null,
    projectConfigPath: resolvedProject?.filePath ?? null,
    timeout(key) {
      return projectFile?.timeout?.[key] ?? TIMEOUT_DEFAULTS[key];
    },
  };
}
