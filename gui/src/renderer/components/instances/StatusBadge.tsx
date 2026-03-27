import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface StatusBadgeProps {
  running: boolean;
  className?: string;
}

export function StatusBadge({ running, className }: StatusBadgeProps) {
  const t = useI18n((s) => s.t);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        running
          ? "bg-success/15 text-success"
          : "bg-muted text-muted-foreground",
        className
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          running ? "bg-success" : "bg-muted-foreground"
        )}
      />
      {running ? t("status.running") : t("status.stopped")}
    </span>
  );
}
