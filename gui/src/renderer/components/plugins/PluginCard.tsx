import { useState } from "react";
import { Package, Download, Trash2, Pencil, Check, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { usePluginStore, type PluginEntry } from "@/stores/plugin-store";

interface PluginCardProps {
  plugin: PluginEntry;
  onInstall: (plugin: PluginEntry) => void;
  onRemove: (plugin: PluginEntry) => void;
}

export function PluginCard({ plugin, onInstall, onRemove }: PluginCardProps) {
  const t = useI18n((s) => s.t);
  const updatePlugin = usePluginStore((s) => s.updatePlugin);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(plugin.name);
  const [version, setVersion] = useState(plugin.version);
  const [description, setDescription] = useState(plugin.description);
  const [author, setAuthor] = useState(plugin.author);
  const [dependencies, setDependencies] = useState(plugin.dependencies.join(", "));
  const [tags, setTags] = useState(plugin.tags.join(", "));

  const handleSave = async () => {
    await updatePlugin(plugin.id, {
      name,
      version,
      description,
      author,
      dependencies,
      tags
    });
    setEditing(false);
  };

  const handleCancel = () => {
    setName(plugin.name);
    setVersion(plugin.version);
    setDescription(plugin.description);
    setAuthor(plugin.author);
    setDependencies(plugin.dependencies.join(", "));
    setTags(plugin.tags.join(", "));
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="rounded-lg border border-ring bg-card p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t("plugins.edit.name")}
            className="rounded border border-border bg-secondary px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring" />
          <input value={version} onChange={(e) => setVersion(e.target.value)}
            placeholder={t("plugins.edit.version")}
            className="rounded border border-border bg-secondary px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring" />
          <input value={author} onChange={(e) => setAuthor(e.target.value)}
            placeholder={t("plugins.edit.author")}
            className="rounded border border-border bg-secondary px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <input value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder={t("plugins.edit.description")}
          className="w-full rounded border border-border bg-secondary px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring" />
        <div className="grid grid-cols-2 gap-2">
          <input value={dependencies} onChange={(e) => setDependencies(e.target.value)}
            placeholder={t("plugins.edit.dependencies")}
            className="rounded border border-border bg-secondary px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring" />
          <input value={tags} onChange={(e) => setTags(e.target.value)}
            placeholder={t("plugins.edit.tags")}
            className="rounded border border-border bg-secondary px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring" />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={handleCancel}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
            <X className="size-3" /> {t("plugins.edit.cancel")}
          </button>
          <button onClick={handleSave}
            className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90">
            <Check className="size-3" /> {t("plugins.edit.save")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
          <Package className="size-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{plugin.name}</span>
            {plugin.version && (
              <span className="text-xs text-muted-foreground">v{plugin.version}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {[
              plugin.jarFile,
              plugin.author,
              plugin.description
            ].filter(Boolean).join(" · ")}
          </p>
          {(plugin.tags.length > 0 || plugin.dependencies.length > 0) && (
            <div className="flex flex-wrap gap-1 mt-1">
              {plugin.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {tag}
                </span>
              ))}
              {plugin.dependencies.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {t("plugins.dependencies")}: {plugin.dependencies.join(", ")}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button onClick={() => setEditing(true)}
          className="flex size-8 items-center justify-center rounded-md hover:bg-accent transition-colors"
          title={t("plugins.edit.title")}>
          <Pencil className="size-4 text-muted-foreground" />
        </button>
        <button onClick={() => onInstall(plugin)}
          className="flex size-8 items-center justify-center rounded-md hover:bg-accent transition-colors"
          title={t("plugins.install")}>
          <Download className="size-4 text-primary" />
        </button>
        <button onClick={() => onRemove(plugin)}
          className="flex size-8 items-center justify-center rounded-md hover:bg-accent transition-colors"
          title={t("plugins.remove")}>
          <Trash2 className="size-4 text-destructive" />
        </button>
      </div>
    </div>
  );
}
