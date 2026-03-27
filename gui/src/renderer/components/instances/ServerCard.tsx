import { useNavigate } from "react-router-dom";
import { Play, Square, Server, Terminal } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { useServerStore } from "@/stores/server-store";

interface ServerCardProps {
  name: string;
  project: string;
  type: string;
  mcVersion: string;
  port: number;
}

export function ServerCard({
  name,
  project,
  type,
  mcVersion,
  port
}: ServerCardProps) {
  const navigate = useNavigate();
  const runtime = useServerStore((s) => s.runtime);
  const execAction = useServerStore((s) => s.execServerAction);
  const stateKey = `${project}/${name}`;
  const running = stateKey in runtime;

  const handleToggle = async () => {
    if (running) {
      await execAction("stop", name, ["--project", project]);
    } else {
      await execAction("start", name, ["--project", project, "--eula"]);
    }
  };

  const openConsole = () => {
    navigate(`/servers/${encodeURIComponent(project)}/${encodeURIComponent(name)}/console`);
  };

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-secondary">
          <Server className="size-5 text-muted-foreground" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{name}</span>
            <StatusBadge running={running} />
          </div>
          <p className="text-xs text-muted-foreground">
            {type} · {mcVersion} · :{port} · {project}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={openConsole}
          className="flex size-8 items-center justify-center rounded-md hover:bg-accent transition-colors"
          title="Console"
        >
          <Terminal className="size-4 text-muted-foreground" />
        </button>
        <button
          onClick={handleToggle}
          className="flex size-8 items-center justify-center rounded-md hover:bg-accent transition-colors"
          title={running ? "Stop" : "Start"}
        >
          {running ? (
            <Square className="size-4 text-destructive" />
          ) : (
            <Play className="size-4 text-success" />
          )}
        </button>
      </div>
    </div>
  );
}
