import { useEffect, useMemo, useState, useCallback } from "react";
import { Package, Plus, Search, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { usePluginStore, type PluginEntry } from "@/stores/plugin-store";
import { PluginCard } from "@/components/plugins/PluginCard";
import { InstallPluginDialog } from "@/components/plugins/InstallPluginDialog";

export function PluginsPage() {
  const t = useI18n((s) => s.t);
  const {
    plugins,
    searchQuery,
    fetch: fetchPlugins,
    setSearchQuery,
    addPlugin,
    removePlugin
  } = usePluginStore();

  const [installTarget, setInstallTarget] = useState<PluginEntry | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);

    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.endsWith(".jar")
    );
    if (files.length === 0) return;

    setUploading(true);
    for (const file of files) {
      await addPlugin(file.path);
    }
    setUploading(false);
  }, [addPlugin]);

  const handleSelectFile = async () => {
    const filePath = await window.electronAPI.selectFile();
    if (filePath) {
      setUploading(true);
      await addPlugin(filePath);
      setUploading(false);
    }
  };

  // Filter
  const filtered = useMemo(() => {
    if (!searchQuery) return plugins;
    const q = searchQuery.toLowerCase();
    return plugins.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }, [plugins, searchQuery]);

  const handleRemove = async (plugin: PluginEntry) => {
    if (confirm(t("plugins.remove_confirm", { name: plugin.name }))) {
      await removePlugin(plugin.id);
    }
  };

  return (
    <div
      className="space-y-6 h-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("plugins.title")}</h1>
        <button
          onClick={handleSelectFile}
          disabled={uploading}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Plus className="size-4" />
          {t("plugins.add")}
        </button>
      </div>

      {/* Search */}
      {plugins.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("plugins.search")}
            className="w-full rounded-md border border-border bg-secondary pl-9 pr-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      {/* Drag overlay */}
      {dragging && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/80 border-2 border-dashed border-primary rounded-lg m-2 pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-primary">
            <Upload className="size-12" />
            <p className="text-lg font-medium">{t("plugins.drop_hint")}</p>
          </div>
        </div>
      )}

      {/* Plugin list */}
      {filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              onInstall={setInstallTarget}
              onRemove={handleRemove}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <Package className="mb-3 size-10 opacity-40" />
          <p className="text-sm">{t("plugins.empty")}</p>
          <p className="text-xs mt-1">{t("plugins.empty_hint")}</p>
        </div>
      )}

      <InstallPluginDialog
        open={!!installTarget}
        plugin={installTarget}
        onClose={() => setInstallTarget(null)}
      />
    </div>
  );
}
