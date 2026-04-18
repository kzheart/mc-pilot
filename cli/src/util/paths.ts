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

export function resolveProjectConfigPath(project: string): string {
  return path.join(resolveProjectDir(project), "project.json");
}

export function resolveProjectScreenshotsDir(project: string): string {
  return path.join(resolveProjectDir(project), "screenshots");
}

export function resolveServerInstanceDir(project: string, server: string): string {
  return path.join(resolveProjectDir(project), server);
}

export function resolveGlobalStateDir(): string {
  return path.join(resolveMctHome(), "state");
}

export function resolvePluginsDir(): string {
  return path.join(resolveMctHome(), "plugins");
}

export function resolvePluginJarsDir(): string {
  return path.join(resolvePluginsDir(), "jars");
}
