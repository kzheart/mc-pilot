export interface PluginEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  jarFile: string;
  dependencies: string[];
  tags: string[];
  addedAt: string;
}

export interface PluginCatalog {
  plugins: PluginEntry[];
}
