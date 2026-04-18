import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ServerInstanceMeta,
  ClientInstanceMeta,
  GlobalServerState,
  GlobalClientState
} from "../../../cli/src/util/instance-types";
import type { MctProjectFile } from "../../../cli/src/util/project";

const MCT_HOME = process.env.MCT_HOME || join(homedir(), ".mct");
const STATE_DIR = join(MCT_HOME, "state");
const PROJECTS_DIR = join(MCT_HOME, "projects");
const CLIENTS_DIR = join(MCT_HOME, "clients");

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readServerState(): Promise<GlobalServerState> {
  const state = await readJsonFile<GlobalServerState>(
    join(STATE_DIR, "servers.json"),
    { servers: {} }
  );
  // Validate PIDs and remove stale entries
  let dirty = false;
  for (const [key, entry] of Object.entries(state.servers)) {
    if (!isProcessRunning(entry.pid)) {
      delete state.servers[key];
      dirty = true;
    }
  }
  if (dirty) {
    try {
      await writeFile(
        join(STATE_DIR, "servers.json"),
        JSON.stringify(state, null, 2) + "\n"
      );
    } catch {
      // ignore write errors
    }
  }
  return state;
}

export async function readClientState(): Promise<GlobalClientState> {
  const state = await readJsonFile<GlobalClientState>(
    join(STATE_DIR, "clients.json"),
    { clients: {} }
  );
  let dirty = false;
  for (const [key, entry] of Object.entries(state.clients)) {
    if (!isProcessRunning(entry.pid)) {
      delete state.clients[key];
      dirty = true;
    }
  }
  if (dirty) {
    try {
      await writeFile(
        join(STATE_DIR, "clients.json"),
        JSON.stringify(state, null, 2) + "\n"
      );
    } catch {
      // ignore write errors
    }
  }
  return state;
}

export interface ProjectInfo {
  id: string;
  name: string;
  rootDir?: string;
  servers: ServerInstanceMeta[];
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const projects: ProjectInfo[] = [];
  try {
    const dirs = await readdir(PROJECTS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const projectDir = join(PROJECTS_DIR, dir.name);
      const projectConfig = await readJsonFile<MctProjectFile | null>(
        join(projectDir, "project.json"),
        null
      );
      const servers = await listServerInstances(dir.name, projectDir);
      projects.push({
        id: dir.name,
        name: projectConfig?.project ?? dir.name,
        rootDir: projectConfig?.rootDir,
        servers
      });
    }
  } catch {
    // projects dir may not exist yet
  }
  return projects;
}

async function listServerInstances(
  project: string,
  projectDir: string
): Promise<(ServerInstanceMeta & { instanceDir: string })[]> {
  const instances: (ServerInstanceMeta & { instanceDir: string })[] = [];
  try {
    const dirs = await readdir(projectDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const instanceDir = join(projectDir, dir.name);
      const meta = await readJsonFile<ServerInstanceMeta | null>(
        join(instanceDir, "instance.json"),
        null
      );
      if (meta) instances.push({ ...meta, instanceDir });
    }
  } catch {
    // ignore
  }
  return instances;
}

export async function listClientInstances(): Promise<ClientInstanceMeta[]> {
  const instances: ClientInstanceMeta[] = [];
  try {
    const dirs = await readdir(CLIENTS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const meta = await readJsonFile<ClientInstanceMeta | null>(
        join(CLIENTS_DIR, dir.name, "instance.json"),
        null
      );
      if (meta) instances.push(meta);
    }
  } catch {
    // clients dir may not exist yet
  }
  return instances;
}

export function getStateDir(): string {
  return STATE_DIR;
}
