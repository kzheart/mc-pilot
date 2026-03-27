import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  Monitor,
  FolderOpen,
  Package,
  Settings
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export function Sidebar() {
  const t = useI18n((s) => s.t);

  const navItems = [
    { to: "/", icon: LayoutDashboard, label: t("nav.dashboard") },
    { to: "/servers", icon: Server, label: t("nav.servers") },
    { to: "/clients", icon: Monitor, label: t("nav.clients") },
    { to: "/projects", icon: FolderOpen, label: t("nav.projects") },
    { to: "/plugins", icon: Package, label: t("nav.plugins") },
    { to: "/settings", icon: Settings, label: t("nav.settings") }
  ];

  return (
    <aside className="flex h-full w-52 flex-col border-r border-border bg-card">
      {/* Drag region + traffic light space on macOS */}
      <div className="drag-region h-10 shrink-0" />
      <nav className="flex-1 space-y-1 px-2 py-2">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
