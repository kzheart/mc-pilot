import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export class StateStore {
  constructor(private readonly rootDir: string) {}

  getRootDir() {
    return this.rootDir;
  }

  async ensure() {
    await mkdir(this.rootDir, { recursive: true });
  }

  async readJson<T>(name: string, fallback: T): Promise<T> {
    await this.ensure();
    const target = path.join(this.rootDir, name);

    try {
      const raw = await readFile(target, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  async writeJson(name: string, value: unknown) {
    await this.ensure();
    const target = path.join(this.rootDir, name);
    const content = JSON.stringify(value, null, 2);
    await writeFile(target, `${content}\n`, "utf8");
  }

  async remove(name: string) {
    await rm(path.join(this.rootDir, name), { force: true });
  }
}

export function resolveStateDir(stateDir: string | undefined, cwd: string) {
  if (!stateDir) {
    return path.join(cwd, ".mct-state");
  }

  return path.isAbsolute(stateDir) ? stateDir : path.resolve(cwd, stateDir);
}
