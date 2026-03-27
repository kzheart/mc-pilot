import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Server,
  Monitor,
  FolderOpen,
  Activity,
  Terminal,
  Plus,
  Clock,
  FileText
} from "lucide-react";
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

function formatUptime(startedAt: string): string {
  const diff = Date.now() - new Date(startedAt).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function RunningServerRow({
  stateKey,
  entry
}: {
  stateKey: string;
  entry: { name: string; project: string; port: number; startedAt: string; logPath: string };
}) {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<string[]>([]);
  const [uptime, setUptime] = useState(formatUptime(entry.startedAt));

  useEffect(() => {
    window.electronAPI.tailLog(entry.logPath, 3).then(setLogs);
  }, [entry.logPath]);

  useEffect(() => {
    const timer = setInterval(() => setUptime(formatUptime(entry.startedAt)), 1000);
    return () => clearInterval(timer);
  }, [entry.startedAt]);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md bg-success/15">
            <Server className="size-4 text-success" />
          </div>
          <div>
            <span className="font-medium text-sm">{entry.name}</span>
            <p className="text-xs text-muted-foreground">
              {entry.project} · :{entry.port}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {uptime}
          </div>
          <button
            onClick={() =>
              navigate(
                `/servers/${encodeURIComponent(entry.project)}/${encodeURIComponent(entry.name)}/console`
              )
            }
            className="flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors"
          >
            <Terminal className="size-3" />
            Console
          </button>
        </div>
      </div>

      {logs.length > 0 && (
        <div className="rounded-md bg-[#1a1a1a] px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground overflow-hidden">
          {logs.map((line, i) => (
            <div key={i} className="truncate">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickActions() {
  const navigate = useNavigate();
  const t = useI18n((s) => s.t);

  const actions = [
    {
      icon: Server,
      label: t("servers.create"),
      onClick: () => navigate("/servers")
    },
    {
      icon: Monitor,
      label: t("clients.create"),
      onClick: () => navigate("/clients")
    },
    {
      icon: Plus,
      label: t("plugins.add"),
      onClick: () => navigate("/plugins")
    }
  ];

  return (
    <div className="flex gap-2">
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-accent transition-colors"
        >
          <action.icon className="size-4 text-muted-foreground" />
          {action.label}
        </button>
      ))}
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
  const runningEntries = Object.entries(serverRuntime);

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

      {/* Quick Actions */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t("dashboard.quick_actions")}
        </h2>
        <QuickActions />
      </section>

      {/* Running servers with uptime + log preview */}
      {runningEntries.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Activity className="size-3.5 text-success" />
            {t("dashboard.servers_section")} · {t("dashboard.running_count", { count: runningServers })}
          </h2>
          <div className="space-y-2">
            {runningEntries.map(([key, entry]) => (
              <RunningServerRow key={key} stateKey={key} entry={entry} />
            ))}
          </div>
        </section>
      )}

      {/* Stopped servers */}
      {allServers.length > runningServers && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("dashboard.servers_section")} · {t("status.stopped")}
          </h2>
          <div className="space-y-2">
            {allServers
              .filter((s) => !(`${s.project}/${s.name}` in serverRuntime))
              .map((s) => (
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
