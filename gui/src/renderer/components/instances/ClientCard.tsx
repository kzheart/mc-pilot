import { Play, Square, Monitor } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { useClientStore } from "@/stores/client-store";

interface ClientCardProps {
  name: string;
  loader: string;
  mcVersion: string;
  wsPort: number;
  account?: string;
}

export function ClientCard({
  name,
  loader,
  mcVersion,
  wsPort,
  account
}: ClientCardProps) {
  const runtime = useClientStore((s) => s.runtime);
  const execAction = useClientStore((s) => s.execClientAction);
  const running = name in runtime;

  const handleToggle = async () => {
    if (running) {
      await execAction("stop", name);
    } else {
      await execAction("launch", name);
    }
  };

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-secondary">
          <Monitor className="size-5 text-muted-foreground" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{name}</span>
            <StatusBadge running={running} />
          </div>
          <p className="text-xs text-muted-foreground">
            {loader} · {mcVersion} · ws:{wsPort}
            {account ? ` · ${account}` : ""}
          </p>
        </div>
      </div>
      <button
        onClick={handleToggle}
        className="flex size-8 items-center justify-center rounded-md hover:bg-accent transition-colors"
        title={running ? "Stop" : "Launch"}
      >
        {running ? (
          <Square className="size-4 text-destructive" />
        ) : (
          <Play className="size-4 text-success" />
        )}
      </button>
    </div>
  );
}
