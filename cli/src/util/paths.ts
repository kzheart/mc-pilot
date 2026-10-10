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

export function resolveGlobalStateDir(): string {
  return path.join(resolveMctHome(), "state");
}

/** Server instances live next to the code under test: `<project>/run/<name>`. */
export function resolveProjectRunDir(projectRoot: string): string {
  return path.join(projectRoot, "run");
}

/** Per-project artifacts that are not server instances (screenshots). */
export function resolveProjectDataDir(projectRoot: string): string {
  return path.join(projectRoot, ".mct");
}

export function resolveProjectScreenshotsDir(projectRoot: string): string {
  return path.join(resolveProjectDataDir(projectRoot), "screenshots");
}
