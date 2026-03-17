import os from "node:os";
import path from "node:path";

import type { ServerType } from "./VersionMatrix.js";
import type { LoaderType } from "./types.js";

export function resolveCacheRoot() {
  return process.env.MCT_CACHE_DIR || path.join(os.homedir(), ".mct", "cache");
}

export class CacheManager {
  constructor(private readonly rootDir = resolveCacheRoot()) {}

  getRootDir() {
    return this.rootDir;
  }

  getServerJarPath(type: ServerType, version: string, build: string) {
    return path.join(this.rootDir, "server", type, `${version}-${build}.jar`);
  }

  getServerFile(type: ServerType, version: string, build: string) {
    return this.getServerJarPath(type, version, build);
  }

  getMinecraftDir(version: string) {
    return path.join(this.rootDir, "client", "minecraft", version);
  }

  getLoaderDir(loader: LoaderType) {
    return path.join(this.rootDir, "client", loader);
  }

  getModFile(fileName: string) {
    return path.join(this.rootDir, "mod", fileName);
  }
}
