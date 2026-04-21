import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_LOCK_TIMEOUT_MS = 15_000;
const DEFAULT_LOCK_STALE_MS = 60_000;
const LOCK_POLL_INTERVAL_MS = 50;

interface LockOwner {
  pid: number;
  acquiredAt: string;
  acquiredAtMs: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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
    const tempTarget = `${target}.${process.pid}.${randomUUID()}.tmp`;
    const content = JSON.stringify(value, null, 2);
    await writeFile(tempTarget, `${content}\n`, "utf8");
    await rename(tempTarget, target);
  }

  async remove(name: string) {
    await rm(path.join(this.rootDir, name), { force: true });
  }

  async withLock<T>(
    name: string,
    task: () => Promise<T>,
    options: { timeoutMs?: number; staleMs?: number } = {}
  ): Promise<T> {
    await this.ensure();

    const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
    const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
    const safeName = name.replace(/[\\/]/g, "-");
    const lockDir = path.join(this.rootDir, `${safeName}.lock`);
    const ownerPath = path.join(lockDir, "owner.json");

    while (true) {
      try {
        await mkdir(lockDir);
        const owner: LockOwner = {
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
          acquiredAtMs: Date.now()
        };
        await writeFile(ownerPath, `${JSON.stringify(owner, null, 2)}\n`, "utf8");
        break;
      } catch (error) {
        const lockExists = typeof error === "object"
          && error !== null
          && "code" in error
          && (error as NodeJS.ErrnoException).code === "EEXIST";
        if (!lockExists) {
          throw error;
        }

        if (await this.cleanupStaleLock(lockDir, ownerPath, staleMs)) {
          continue;
        }

        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for lock ${safeName}`);
        }

        await sleep(LOCK_POLL_INTERVAL_MS);
      }
    }

    try {
      return await task();
    } finally {
      await rm(lockDir, { recursive: true, force: true });
    }
  }

  private async cleanupStaleLock(lockDir: string, ownerPath: string, staleMs: number) {
    try {
      const raw = await readFile(ownerPath, "utf8");
      const owner = JSON.parse(raw) as Partial<LockOwner>;
      const pid = Number(owner.pid);
      const acquiredAtMs = typeof owner.acquiredAtMs === "number" ? owner.acquiredAtMs : NaN;
      const ownerAlive = Number.isInteger(pid) && pid > 0 ? isPidRunning(pid) : false;
      const isStale = Number.isFinite(acquiredAtMs) && Date.now() - acquiredAtMs > staleMs;

      if (!ownerAlive || isStale) {
        await rm(lockDir, { recursive: true, force: true });
        return true;
      }
    } catch {
      // The owner file may not exist yet while another process is finalizing lock acquisition.
    }

    return false;
  }
}

export function resolveStateDir(stateDir: string | undefined, cwd: string) {
  if (!stateDir) {
    return path.join(cwd, ".mct-state");
  }

  return path.isAbsolute(stateDir) ? stateDir : path.resolve(cwd, stateDir);
}
