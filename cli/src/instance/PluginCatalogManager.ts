import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolvePluginsDir, resolvePluginJarsDir, resolveServerInstanceDir } from "../util/paths.js";
import { MctError } from "../util/errors.js";
import type { PluginCatalog, PluginEntry } from "../util/plugin-types.js";

const CATALOG_FILE = "catalog.json";

export class PluginCatalogManager {
  private pluginsDir: string;
  private jarsDir: string;

  constructor() {
    this.pluginsDir = resolvePluginsDir();
    this.jarsDir = resolvePluginJarsDir();
  }

  async loadCatalog(): Promise<PluginCatalog> {
    try {
      const content = await readFile(path.join(this.pluginsDir, CATALOG_FILE), "utf-8");
      return JSON.parse(content) as PluginCatalog;
    } catch {
      return { plugins: [] };
    }
  }

  private async saveCatalog(catalog: PluginCatalog): Promise<void> {
    await mkdir(this.pluginsDir, { recursive: true });
    await writeFile(
      path.join(this.pluginsDir, CATALOG_FILE),
      JSON.stringify(catalog, null, 2),
      "utf-8"
    );
  }

  async list(query?: string): Promise<PluginEntry[]> {
    const catalog = await this.loadCatalog();
    if (!query) return catalog.plugins;

    const q = query.toLowerCase();
    return catalog.plugins.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  async get(id: string): Promise<PluginEntry> {
    const catalog = await this.loadCatalog();
    const entry = catalog.plugins.find((p) => p.id === id);
    if (!entry) {
      throw new MctError(
        { code: "PLUGIN_NOT_FOUND", message: `Plugin '${id}' not found in catalog` },
        4
      );
    }
    return entry;
  }

  async add(
    jarPath: string,
    overrides?: Partial<Omit<PluginEntry, "jarFile" | "addedAt">>
  ): Promise<PluginEntry> {
    const catalog = await this.loadCatalog();
    const resolvedJar = path.resolve(jarPath);
    const originalName = path.basename(resolvedJar, ".jar");

    // Derive id from filename if not provided
    const id = overrides?.id || originalName.toLowerCase().replace(/[^a-z0-9_-]/g, "-");

    if (catalog.plugins.some((p) => p.id === id)) {
      throw new MctError(
        { code: "PLUGIN_EXISTS", message: `Plugin '${id}' already exists in catalog` },
        4
      );
    }

    // Keep original JAR filename
    const jarFileName = path.basename(resolvedJar);

    await mkdir(this.jarsDir, { recursive: true });
    await copyFile(resolvedJar, path.join(this.jarsDir, jarFileName));

    const entry: PluginEntry = {
      id,
      name: overrides?.name || originalName,
      version: overrides?.version || "",
      description: overrides?.description || "",
      author: overrides?.author || "",
      jarFile: jarFileName,
      dependencies: overrides?.dependencies || [],
      tags: overrides?.tags || [],
      addedAt: new Date().toISOString()
    };

    catalog.plugins.push(entry);
    await this.saveCatalog(catalog);
    return entry;
  }

  async update(
    id: string,
    fields: Partial<Omit<PluginEntry, "id" | "jarFile" | "addedAt">>
  ): Promise<PluginEntry> {
    const catalog = await this.loadCatalog();
    const entry = catalog.plugins.find((p) => p.id === id);
    if (!entry) {
      throw new MctError(
        { code: "PLUGIN_NOT_FOUND", message: `Plugin '${id}' not found in catalog` },
        4
      );
    }

    if (fields.name !== undefined) entry.name = fields.name;
    if (fields.version !== undefined) entry.version = fields.version;
    if (fields.description !== undefined) entry.description = fields.description;
    if (fields.author !== undefined) entry.author = fields.author;
    if (fields.dependencies !== undefined) entry.dependencies = fields.dependencies;
    if (fields.tags !== undefined) entry.tags = fields.tags;

    await this.saveCatalog(catalog);
    return entry;
  }

  async remove(id: string): Promise<PluginEntry> {
    const catalog = await this.loadCatalog();
    const index = catalog.plugins.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new MctError(
        { code: "PLUGIN_NOT_FOUND", message: `Plugin '${id}' not found in catalog` },
        4
      );
    }

    const [entry] = catalog.plugins.splice(index, 1);

    try {
      await rm(path.join(this.jarsDir, entry.jarFile));
    } catch {
      // JAR file may already be deleted
    }

    await this.saveCatalog(catalog);
    return entry;
  }

  async resolve(ids: string[]): Promise<PluginEntry[]> {
    const catalog = await this.loadCatalog();
    const byId = new Map(catalog.plugins.map((p) => [p.id, p]));

    const resolved: PluginEntry[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new MctError(
          { code: "CIRCULAR_DEPENDENCY", message: `Circular dependency detected involving '${id}'` },
          4
        );
      }

      const entry = byId.get(id);
      if (!entry) {
        throw new MctError(
          { code: "MISSING_DEPENDENCY", message: `Missing dependency: '${id}'` },
          4
        );
      }

      visiting.add(id);
      for (const dep of entry.dependencies) {
        visit(dep);
      }
      visiting.delete(id);
      visited.add(id);
      resolved.push(entry);
    };

    for (const id of ids) {
      visit(id);
    }
    return resolved;
  }

  async install(
    id: string,
    project: string,
    serverName: string
  ): Promise<{ installed: string[]; serverPluginsDir: string }> {
    const toInstall = await this.resolve([id]);
    const serverPluginsDir = path.join(resolveServerInstanceDir(project, serverName), "plugins");
    await mkdir(serverPluginsDir, { recursive: true });

    const installed: string[] = [];
    for (const entry of toInstall) {
      const src = path.join(this.jarsDir, entry.jarFile);
      const dest = path.join(serverPluginsDir, entry.jarFile);
      await copyFile(src, dest);
      installed.push(entry.id);
    }
    return { installed, serverPluginsDir };
  }
}
