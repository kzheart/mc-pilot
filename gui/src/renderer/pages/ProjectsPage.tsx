import { useEffect } from "react";
import { FolderOpen, Server } from "lucide-react";
import { useServerStore } from "@/stores/server-store";
import { useI18n } from "@/lib/i18n";

export function ProjectsPage() {
  const { projects, fetch: fetchServers } = useServerStore();
  const t = useI18n((s) => s.t);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t("projects.title")}</h1>

      {projects.length > 0 ? (
        <div className="space-y-4">
          {projects.map((project) => (
            <div
              key={project.name}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-secondary">
                  <FolderOpen className="size-4 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="font-medium text-sm">{project.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t("projects.server_count", {
                      count: project.servers.length
                    })}
                  </p>
                </div>
              </div>
              {project.servers.length > 0 && (
                <div className="space-y-1.5 pl-12">
                  {project.servers.map((s) => (
                    <div
                      key={s.name}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <Server className="size-3" />
                      <span>
                        {s.name} — {s.type} {s.mcVersion} :{s.port}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <FolderOpen className="mb-3 size-10 opacity-40" />
          <p className="text-sm">{t("projects.empty")}</p>
          <p className="text-xs mt-1">{t("projects.empty_hint")}</p>
        </div>
      )}
    </div>
  );
}
