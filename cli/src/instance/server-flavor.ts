import { writeFile } from "node:fs/promises";
import path from "node:path";

import { MctError } from "../util/errors.js";
import type { ServerInstanceMeta, ServerType } from "../util/instance-types.js";
import { ensureServerProperties } from "./ServerInstanceManager.js";

export interface FlavorContext {
  instanceDir: string;
  meta: ServerInstanceMeta;
}

export interface ServerFlavor {
  kind: "game" | "proxy";
  supportsEula: boolean;
  buildLaunchArgs(jvmArgs: string[], jarFile: string): string[];
  syncConfig(ctx: FlavorContext): Promise<void>;
}

const vanillaLikeFlavor: ServerFlavor = {
  kind: "game",
  supportsEula: true,
  buildLaunchArgs(jvmArgs: string[], jarFile: string): string[] {
    return [...jvmArgs, "-jar", jarFile, "nogui"];
  },
  async syncConfig({ instanceDir, meta }: FlavorContext): Promise<void> {
    await ensureServerProperties(instanceDir, {
      "server-port": String(meta.port),
      "online-mode": String(meta.onlineMode ?? false),
    });
  },
};

const velocityFlavor: ServerFlavor = {
  kind: "proxy",
  supportsEula: false,
  buildLaunchArgs(jvmArgs: string[], jarFile: string): string[] {
    return [...jvmArgs, "-jar", jarFile];
  },
  async syncConfig({ instanceDir, meta }: FlavorContext): Promise<void> {
    const content = renderVelocityToml(meta);
    await writeFile(path.join(instanceDir, "velocity.toml"), content, "utf8");
  },
};

const bungeecordFlavor: ServerFlavor = {
  kind: "proxy",
  supportsEula: false,
  buildLaunchArgs(jvmArgs: string[], jarFile: string): string[] {
    return [...jvmArgs, "-jar", jarFile];
  },
  async syncConfig({ instanceDir, meta }: FlavorContext): Promise<void> {
    const content = renderBungeeConfigYml(meta);
    await writeFile(path.join(instanceDir, "config.yml"), content, "utf8");
  },
};

export function getServerFlavor(type: ServerType): ServerFlavor {
  switch (type) {
    case "paper":
    case "purpur":
    case "spigot":
    case "vanilla":
      return vanillaLikeFlavor;
    case "velocity":
      return velocityFlavor;
    case "bungeecord":
      return bungeecordFlavor;
    default:
      throw new MctError(
        { code: "INVALID_PARAMS", message: `Unknown server type ${type}` },
        4,
      );
  }
}

export function renderVelocityToml(meta: ServerInstanceMeta): string {
  const onlineMode = meta.onlineMode ?? false;
  const forwarding = meta.proxy?.forwarding === "legacy" ? "legacy" : "modern";
  const servers = meta.proxy?.servers ?? {};
  const tryList = meta.proxy?.try ?? [];

  const serverLines = Object.keys(servers).map(
    (name) => `${name} = "${servers[name]}"`,
  );
  const tryEntries = tryList.map((name) => `"${name}"`).join(", ");

  const lines = [
    "# Managed by mct - regenerated on every start; manual edits will be overwritten",
    'config-version = "2.7"',
    `bind = "0.0.0.0:${meta.port}"`,
    `online-mode = ${onlineMode}`,
    `player-info-forwarding-mode = "${forwarding}"`,
    'forwarding-secret-file = "forwarding.secret"',
    "",
    "[servers]",
    ...serverLines,
    `try = [${tryEntries}]`,
    "",
    // 必须显式写空段:缺失时 Velocity 会套用带 lobby.example.com 示例的
    // 内置默认 forced-hosts,引用不存在的服务器导致启动校验失败
    "[forced-hosts]",
    "",
  ];

  return lines.join("\n");
}

export function renderBungeeConfigYml(meta: ServerInstanceMeta): string {
  const onlineMode = meta.onlineMode ?? false;
  const priorities = meta.proxy?.try ?? [];
  const servers = meta.proxy?.servers ?? {};

  const lines = [
    "# Managed by mct - regenerated on every start; manual edits will be overwritten",
    "listeners:",
    `- host: 0.0.0.0:${meta.port}`,
    "  motd: mct",
    "  query_enabled: false",
  ];

  if (priorities.length === 0) {
    lines.push("  priorities: []");
  } else {
    lines.push("  priorities:");
    for (const name of priorities) {
      lines.push(`  - ${name}`);
    }
  }

  lines.push(`online_mode: ${onlineMode}`);
  lines.push("ip_forward: true");

  const serverNames = Object.keys(servers);
  if (serverNames.length === 0) {
    lines.push("servers: {}");
  } else {
    lines.push("servers:");
    for (const name of serverNames) {
      lines.push(`  ${name}:`);
      lines.push(`    address: ${servers[name]}`);
      lines.push("    restricted: false");
    }
  }

  lines.push("");
  return lines.join("\n");
}
