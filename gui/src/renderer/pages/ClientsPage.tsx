import { useEffect } from "react";
import { Monitor, Plus } from "lucide-react";
import { useClientStore } from "@/stores/client-store";
import { useI18n } from "@/lib/i18n";
import { ClientCard } from "@/components/instances/ClientCard";

export function ClientsPage() {
  const { instances, fetch: fetchClients } = useClientStore();
  const t = useI18n((s) => s.t);

  useEffect(() => {
    fetchClients();
    const unsubscribe = window.electronAPI.onStateChange((type) => {
      if (type === "clients") fetchClients();
    });
    return unsubscribe;
  }, [fetchClients]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("clients.title")}</h1>
        <button className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
          <Plus className="size-4" />
          {t("clients.create")}
        </button>
      </div>

      {instances.length > 0 ? (
        <div className="space-y-2">
          {instances.map((c) => (
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
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <Monitor className="mb-3 size-10 opacity-40" />
          <p className="text-sm">{t("clients.empty")}</p>
          <p className="text-xs mt-1">
            <code className="rounded bg-secondary px-1.5 py-0.5 font-mono">
              {t("clients.empty_hint")}
            </code>
          </p>
        </div>
      )}
    </div>
  );
}
