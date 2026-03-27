import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ServerInstanceMeta,
  ClientInstanceMeta,
  GlobalServerState,
  GlobalClientState
} from "../../../cli/src/util/instance-types";

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

export async function readServerState(): Promise<GlobalServerState> {
  return readJsonFile(join(STATE_DIR, "servers.json"), { servers: {} });
}

export async function readClientState(): Promise<GlobalClientState> {
  return readJsonFile(join(STATE_DIR, "clients.json"), { clients: {} });
}

export interface ProjectInfo {
  name: string;
  servers: ServerInstanceMeta[];
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const projects: ProjectInfo[] = [];
  try {
    const dirs = await readdir(PROJECTS_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const projectDir = join(PROJECTS_DIR, dir.name);
      const servers = await listServerInstances(dir.name, projectDir);
      projects.push({ name: dir.name, servers });
    }
  } catch {
    // projects dir may not exist yet
  }
  return projects;
}

async function listServerInstances(
  project: string,
  projectDir: string
): Promise<ServerInstanceMeta[]> {
  const instances: ServerInstanceMeta[] = [];
  try {
    const dirs = await readdir(projectDir, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      const meta = await readJsonFile<ServerInstanceMeta | null>(
        join(projectDir, dir.name, "instance.json"),
        null
      );
      if (meta) instances.push(meta);
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
