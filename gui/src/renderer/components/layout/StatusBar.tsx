import { useServerStore } from "@/stores/server-store";
import { useClientStore } from "@/stores/client-store";
import { useI18n } from "@/lib/i18n";
import { Server, Monitor } from "lucide-react";

export function StatusBar() {
  const runtime = useServerStore((s) => s.runtime);
  const clientRuntime = useClientStore((s) => s.runtime);
  const t = useI18n((s) => s.t);

  const runningServers = Object.keys(runtime).length;
  const runningClients = Object.keys(clientRuntime).length;

  return (
    <footer className="flex h-7 items-center gap-4 border-t border-border bg-card px-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Server className="size-3" />
        {t("statusbar.servers", { count: runningServers })}
      </span>
      <span className="flex items-center gap-1.5">
        <Monitor className="size-3" />
        {t("statusbar.clients", { count: runningClients })}
      </span>
    </footer>
  );
}
