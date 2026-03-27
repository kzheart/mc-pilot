import { useEffect } from "react";
import { Server, Monitor, FolderOpen, Activity } from "lucide-react";
import { useServerStore } from "@/stores/server-store";
import { useClientStore } from "@/stores/client-store";
import { useI18n } from "@/lib/i18n";
import { ServerCard } from "@/components/instances/ServerCard";
import { ClientCard } from "@/components/instances/ClientCard";

function StatCard({
  icon: Icon,
  label,
  value,
  sub
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-md bg-secondary">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-2xl font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">
            {label}
            {sub ? ` · ${sub}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const {
    projects,
    runtime: serverRuntime,
    fetch: fetchServers
  } = useServerStore();
  const {
    instances: clientInstances,
    runtime: clientRuntime,
    fetch: fetchClients
  } = useClientStore();
  const t = useI18n((s) => s.t);

  useEffect(() => {
    fetchServers();
    fetchClients();

    const unsubscribe = window.electronAPI.onStateChange((type) => {
      if (type === "servers") fetchServers();
      if (type === "clients") fetchClients();
    });
    return unsubscribe;
  }, [fetchServers, fetchClients]);

  const allServers = projects.flatMap((p) => p.servers);
  const runningServers = Object.keys(serverRuntime).length;
  const runningClients = Object.keys(clientRuntime).length;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t("dashboard.title")}</h1>

      <div className="grid grid-cols-4 gap-4">
        <StatCard
          icon={FolderOpen}
          label={t("dashboard.projects")}
          value={projects.length}
        />
        <StatCard
          icon={Server}
          label={t("dashboard.servers")}
          value={allServers.length}
          sub={t("dashboard.running_count", { count: runningServers })}
        />
        <StatCard
          icon={Monitor}
          label={t("dashboard.clients")}
          value={clientInstances.length}
          sub={t("dashboard.running_count", { count: runningClients })}
        />
        <StatCard
          icon={Activity}
          label={t("dashboard.running")}
          value={runningServers + runningClients}
        />
      </div>

      {allServers.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("dashboard.servers_section")}
          </h2>
          <div className="space-y-2">
            {allServers.map((s) => (
              <ServerCard
                key={`${s.project}/${s.name}`}
                name={s.name}
                project={s.project}
                type={s.type}
                mcVersion={s.mcVersion}
                port={s.port}
              />
            ))}
          </div>
        </section>
      )}

      {clientInstances.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("dashboard.clients_section")}
          </h2>
          <div className="space-y-2">
            {clientInstances.map((c) => (
              <ClientCard
                key={c.name}
                name={c.name}
                loader={c.loader}
                mcVersion={c.mcVersion}
                wsPort={c.wsPort}
                account={c.account}
              />
            ))}
          </div>
        </section>
      )}

      {allServers.length === 0 && clientInstances.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <Server className="mb-3 size-10 opacity-40" />
          <p className="text-sm">{t("dashboard.no_instances")}</p>
          <p className="text-xs mt-1">{t("dashboard.no_instances_hint")}</p>
        </div>
      )}
    </div>
  );
}
