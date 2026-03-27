import { create } from "zustand";

export type Locale = "zh" | "en";

const translations = {
  zh: {
    // Sidebar
    "nav.dashboard": "仪表盘",
    "nav.servers": "服务器",
    "nav.clients": "客户端",
    "nav.projects": "项目",
    "nav.plugins": "插件中心",
    "nav.settings": "设置",

    // Dashboard
    "dashboard.title": "仪表盘",
    "dashboard.projects": "项目",
    "dashboard.servers": "服务器",
    "dashboard.clients": "客户端",
    "dashboard.running": "运行中",
    "dashboard.running_count": "{count} 个运行中",
    "dashboard.servers_section": "服务器",
    "dashboard.clients_section": "客户端",
    "dashboard.no_instances": "暂无实例",
    "dashboard.no_instances_hint": "通过 CLI 或管理页面创建服务器和客户端实例",

    // Status
    "status.running": "运行中",
    "status.stopped": "已停止",

    // Servers
    "servers.title": "服务器",
    "servers.create": "创建服务器",
    "servers.no_servers_in_project": "此项目暂无服务器",
    "servers.empty": "暂无服务器实例",
    "servers.empty_hint": "运行 mct server create 创建",

    // Clients
    "clients.title": "客户端",
    "clients.create": "创建客户端",
    "clients.empty": "暂无客户端实例",
    "clients.empty_hint": "运行 mct client create 创建",

    // Projects
    "projects.title": "项目",
    "projects.server_count": "{count} 个服务器",
    "projects.empty": "暂无项目",
    "projects.empty_hint": "在项目目录运行 mct init 开始",

    // Plugins
    "plugins.title": "插件中心",
    "plugins.add": "添加插件",
    "plugins.search": "搜索插件…",
    "plugins.empty": "暂无插件",
    "plugins.empty_hint": "拖拽 JAR 文件到此处，或点击「添加插件」",
    "plugins.drop_hint": "松开以添加插件",
    "plugins.dependencies": "依赖",
    "plugins.install": "安装到服务器",
    "plugins.remove": "移除",
    "plugins.remove_confirm": "确认移除插件 {name}？JAR 文件也将被删除。",
    "plugins.edit.title": "编辑",
    "plugins.edit.name": "名称",
    "plugins.edit.version": "版本",
    "plugins.edit.author": "作者",
    "plugins.edit.description": "描述",
    "plugins.edit.dependencies": "依赖（逗号分隔）",
    "plugins.edit.tags": "标签（逗号分隔）",
    "plugins.edit.save": "保存",
    "plugins.edit.cancel": "取消",
    "plugins.install_dialog.title": "安装插件到服务器",
    "plugins.install_dialog.project": "选择项目",
    "plugins.install_dialog.server": "选择服务器",
    "plugins.install_dialog.will_install": "将安装以下插件：",
    "plugins.install_dialog.cancel": "取消",
    "plugins.install_dialog.confirm": "安装",

    // Settings
    "settings.title": "设置",
    "settings.language": "语言",
    "settings.language_hint": "选择界面语言",

    // StatusBar
    "statusbar.servers": "{count} 个服务器运行中",
    "statusbar.clients": "{count} 个客户端运行中"
  },
  en: {
    "nav.dashboard": "Dashboard",
    "nav.servers": "Servers",
    "nav.clients": "Clients",
    "nav.projects": "Projects",
    "nav.plugins": "Plugin Center",
    "nav.settings": "Settings",

    "dashboard.title": "Dashboard",
    "dashboard.projects": "Projects",
    "dashboard.servers": "Servers",
    "dashboard.clients": "Clients",
    "dashboard.running": "Running",
    "dashboard.running_count": "{count} running",
    "dashboard.servers_section": "Servers",
    "dashboard.clients_section": "Clients",
    "dashboard.no_instances": "No instances found",
    "dashboard.no_instances_hint":
      "Create server and client instances using the CLI or the management pages",

    "status.running": "Running",
    "status.stopped": "Stopped",

    "servers.title": "Servers",
    "servers.create": "Create Server",
    "servers.no_servers_in_project": "No servers in this project",
    "servers.empty": "No server instances",
    "servers.empty_hint": "Run mct server create to create one",

    "clients.title": "Clients",
    "clients.create": "Create Client",
    "clients.empty": "No client instances",
    "clients.empty_hint": "Run mct client create to create one",

    "projects.title": "Projects",
    "projects.server_count": "{count} server(s)",
    "projects.empty": "No projects found",
    "projects.empty_hint": "Run mct init in a project directory to get started",

    "plugins.title": "Plugin Center",
    "plugins.add": "Add Plugin",
    "plugins.search": "Search plugins...",
    "plugins.empty": "No plugins",
    "plugins.empty_hint": "Drag JAR files here, or click 'Add Plugin'",
    "plugins.drop_hint": "Drop to add plugins",
    "plugins.dependencies": "Dependencies",
    "plugins.install": "Install to Server",
    "plugins.remove": "Remove",
    "plugins.remove_confirm": "Remove plugin {name}? The JAR file will also be deleted.",
    "plugins.edit.title": "Edit",
    "plugins.edit.name": "Name",
    "plugins.edit.version": "Version",
    "plugins.edit.author": "Author",
    "plugins.edit.description": "Description",
    "plugins.edit.dependencies": "Dependencies (comma-separated)",
    "plugins.edit.tags": "Tags (comma-separated)",
    "plugins.edit.save": "Save",
    "plugins.edit.cancel": "Cancel",
    "plugins.install_dialog.title": "Install Plugin to Server",
    "plugins.install_dialog.project": "Select Project",
    "plugins.install_dialog.server": "Select Server",
    "plugins.install_dialog.will_install": "The following plugins will be installed:",
    "plugins.install_dialog.cancel": "Cancel",
    "plugins.install_dialog.confirm": "Install",

    "settings.title": "Settings",
    "settings.language": "Language",
    "settings.language_hint": "Select interface language",

    "statusbar.servers": "{count} server(s) running",
    "statusbar.clients": "{count} client(s) running"
  }
} as const;

type TranslationKey = keyof (typeof translations)["zh"];

interface I18nStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

function getDefaultLocale(): Locale {
  const saved = localStorage.getItem("mc-pilot-locale");
  if (saved === "en" || saved === "zh") return saved;
  return "zh";
}

export const useI18n = create<I18nStore>((set, get) => ({
  locale: getDefaultLocale(),

  setLocale: (locale) => {
    localStorage.setItem("mc-pilot-locale", locale);
    set({ locale });
  },

  t: (key, params) => {
    const { locale } = get();
    let text = translations[locale][key] ?? translations.en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  }
}));
