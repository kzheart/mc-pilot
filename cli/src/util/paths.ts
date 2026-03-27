import os from "node:os";
import path from "node:path";

export function resolveMctHome(): string {
  return process.env.MCT_HOME || path.join(os.homedir(), ".mct");
}

export function resolveClientsDir(): string {
  return path.join(resolveMctHome(), "clients");
}

export function resolveClientInstanceDir(name: string): string {
  return path.join(resolveClientsDir(), name);
}

export function resolveProjectsDir(): string {
  return path.join(resolveMctHome(), "projects");
}

export function resolveProjectDir(project: string): string {
  return path.join(resolveProjectsDir(), project);
}

export function resolveServerInstanceDir(project: string, server: string): string {
  return path.join(resolveProjectDir(project), server);
}

export function resolveGlobalStateDir(): string {
  return path.join(resolveMctHome(), "state");
}
