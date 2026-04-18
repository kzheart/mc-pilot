import { useState, useEffect } from "react";
import { X, Download } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useServerStore } from "@/stores/server-store";
import { usePluginStore, type PluginEntry } from "@/stores/plugin-store";

interface InstallPluginDialogProps {
  open: boolean;
  plugin: PluginEntry | null;
  onClose: () => void;
}

export function InstallPluginDialog({
  open,
  plugin,
  onClose
}: InstallPluginDialogProps) {
  const t = useI18n((s) => s.t);
  const projects = useServerStore((s) => s.projects);
  const fetchServers = useServerStore((s) => s.fetch);
  const installPlugin = usePluginStore((s) => s.installPlugin);

  const [selectedProject, setSelectedProject] = useState("");
  const [selectedServer, setSelectedServer] = useState("");
  const [resolvedDeps, setResolvedDeps] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetchServers();
      setSelectedProject("");
      setSelectedServer("");
      setResolvedDeps([]);
      setError(null);
    }
  }, [open, fetchServers]);

  // Resolve deps when plugin is set
  useEffect(() => {
    if (!plugin || !open) return;
    window.electronAPI
      .execMct(["plugin", "resolve", plugin.id])
      .then((result) => {
        if (result.success && result.data) {
          const data = result.data as { order: string[] };
          setResolvedDeps(data.order ?? [plugin.id]);
        }
      });
  }, [plugin, open]);

  // Auto-select server when project changes
  const currentProject = projects.find((p) => p.id === selectedProject);
  useEffect(() => {
    if (currentProject?.servers.length === 1) {
      setSelectedServer(currentProject.servers[0].name);
    } else {
      setSelectedServer("");
    }
  }, [currentProject]);

  if (!open || !plugin) return null;

  const handleInstall = async () => {
    if (!selectedProject || !selectedServer) return;
    setSubmitting(true);
    setError(null);

    const result = await installPlugin(plugin.id, selectedProject, selectedServer);
    setSubmitting(false);
    if (result.success) {
      onClose();
    } else {
      const err = result.error as { message?: string } | undefined;
      setError(err?.message ?? "Failed to install plugin");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {t("plugins.install_dialog.title")}
          </h2>
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-md hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-sm">
            <span className="font-medium">{plugin.name}</span>{" "}
            <span className="text-muted-foreground">v{plugin.version}</span>
          </p>

          {/* Project select */}
          <div>
            <label className="text-sm font-medium mb-1 block">
              {t("plugins.install_dialog.project")}
            </label>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">--</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Server select */}
          {currentProject && (
            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("plugins.install_dialog.server")}
              </label>
              <select
                value={selectedServer}
                onChange={(e) => setSelectedServer(e.target.value)}
                className="w-full rounded-md border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">--</option>
                {currentProject.servers.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({s.type} {s.mcVersion})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Resolved deps */}
          {resolvedDeps.length > 1 && (
            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("plugins.install_dialog.will_install")}
              </label>
              <div className="space-y-1">
                {resolvedDeps.map((dep) => (
                  <div
                    key={dep}
                    className="flex items-center gap-2 rounded bg-secondary px-2 py-1 text-xs"
                  >
                    <Download className="size-3 text-muted-foreground" />
                    {dep}
                    {dep === plugin.id && (
                      <span className="text-muted-foreground">(target)</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded-md border border-border px-4 py-1.5 text-sm hover:bg-accent transition-colors"
            >
              {t("plugins.install_dialog.cancel")}
            </button>
            <button
              onClick={handleInstall}
              disabled={!selectedProject || !selectedServer || submitting}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {t("plugins.install_dialog.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
