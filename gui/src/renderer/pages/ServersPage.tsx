import { useEffect } from "react";
import { Server, Plus } from "lucide-react";
import { useServerStore } from "@/stores/server-store";
import { useI18n } from "@/lib/i18n";
import { ServerCard } from "@/components/instances/ServerCard";

export function ServersPage() {
  const { projects, fetch: fetchServers } = useServerStore();
  const t = useI18n((s) => s.t);

  useEffect(() => {
    fetchServers();
    const unsubscribe = window.electronAPI.onStateChange((type) => {
      if (type === "servers") fetchServers();
    });
    return unsubscribe;
  }, [fetchServers]);

  const allServers = projects.flatMap((p) => p.servers);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("servers.title")}</h1>
        <button className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
          <Plus className="size-4" />
          {t("servers.create")}
        </button>
      </div>

      {projects.map((project) => (
        <section key={project.name} className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {project.name}
          </h2>
          {project.servers.length > 0 ? (
            <div className="space-y-2">
              {project.servers.map((s) => (
                <ServerCard
                  key={`${s.project}/${s.name}`}
                  name={s.name}
                  project={s.project}
                  type={s.type}
                  mcVersion={s.mcVersion}
                  port={s.port}
                  instanceDir={s.instanceDir}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("servers.no_servers_in_project")}
            </p>
          )}
        </section>
      ))}

      {allServers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <Server className="mb-3 size-10 opacity-40" />
          <p className="text-sm">{t("servers.empty")}</p>
          <p className="text-xs mt-1">
            <code className="rounded bg-secondary px-1.5 py-0.5 font-mono">
              {t("servers.empty_hint")}
            </code>
          </p>
        </div>
      )}
    </div>
  );
}
