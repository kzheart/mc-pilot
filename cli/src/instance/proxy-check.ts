import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ServerKind } from "./server-flavor.js";

export interface ProxyCheckInput {
  proxy: { name: string; dir: string; kind: ServerKind };
  backends: Array<{ name: string; dir: string; port: number }>;
}

export interface ProxyCheckResult {
  /** Misconfigurations that make players unable to reach a backend. */
  issues: string[];
  /** Checks skipped because a config file has not been generated yet. */
  warnings: string[];
}

async function readText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/** Read a scalar from indentation-based YAML by key path (no lists, no flow style). */
export function readYamlScalar(
  raw: string,
  keys: string[],
): string | undefined {
  let depth = 0;
  let parentIndent = -1;
  // Indent of the current section's direct children; top-level keys sit at 0.
  let childIndent: number | null = 0;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= parentIndent) {
      return undefined;
    }
    childIndent ??= indent;
    if (indent !== childIndent) continue;

    const match = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!match || match[1].trim() !== keys[depth]) continue;
    if (depth === keys.length - 1) {
      return match[2].replace(/\s+#.*$/, "").replace(/^['"]|['"]$/g, "");
    }
    depth += 1;
    parentIndent = indent;
    childIndent = null;
  }
  return undefined;
}

function listedPorts(addresses: string[]): Set<number> {
  const ports = new Set<number>();
  for (const address of addresses) {
    const port = Number(address.match(/:(\d+)$/)?.[1]);
    if (port) ports.add(port);
  }
  return ports;
}

function parseVelocityServers(toml: string): string[] {
  const addresses: string[] = [];
  let inServers = false;
  for (const line of toml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inServers = trimmed === "[servers]";
      continue;
    }
    const match = inServers
      ? trimmed.match(/^(?:"[^"]*"|[\w.-]+)\s*=\s*"([^"]+)"/)
      : null;
    if (match) addresses.push(match[1]);
  }
  return addresses;
}

async function checkModernBackend(
  backend: ProxyCheckInput["backends"][number],
  secret: string | null,
  result: ProxyCheckResult,
) {
  const paperGlobal = await readText(
    path.join(backend.dir, "config", "paper-global.yml"),
  );
  const paperYml = await readText(path.join(backend.dir, "paper.yml"));
  const keys = paperGlobal
    ? ["proxies", "velocity"]
    : ["settings", "velocity-support"];
  const raw = paperGlobal ?? paperYml;
  if (!raw) {
    result.warnings.push(
      `${backend.name}: no config/paper-global.yml or paper.yml yet; start it once, then enable Velocity modern forwarding there`,
    );
    return;
  }

  const file = paperGlobal ? "config/paper-global.yml" : "paper.yml";
  if (readYamlScalar(raw, [...keys, "enabled"]) !== "true") {
    result.issues.push(
      `${backend.name}: Velocity modern forwarding is disabled; set ${keys.join(".")}.enabled: true in ${file}`,
    );
  }
  const backendSecret = readYamlScalar(raw, [...keys, "secret"]);
  if (secret !== null && backendSecret !== secret) {
    result.issues.push(
      `${backend.name}: ${keys.join(".")}.secret in ${file} does not match the proxy's forwarding secret`,
    );
  }
}

async function checkLegacyBackend(
  backend: ProxyCheckInput["backends"][number],
  result: ProxyCheckResult,
) {
  const spigotYml = await readText(path.join(backend.dir, "spigot.yml"));
  if (!spigotYml) {
    result.warnings.push(
      `${backend.name}: no spigot.yml yet; start it once, then set settings.bungeecord: true`,
    );
    return;
  }
  if (readYamlScalar(spigotYml, ["settings", "bungeecord"]) !== "true") {
    result.issues.push(
      `${backend.name}: legacy forwarding requires settings.bungeecord: true in spigot.yml`,
    );
  }
}

/**
 * Check that a proxy and its backends agree on routing and forwarding.
 *
 * mct no longer writes proxy config; these are the mismatches that made
 * proxy tests fail with opaque kicks, reported before anything starts.
 */
export async function checkProxyForwarding(
  input: ProxyCheckInput,
): Promise<ProxyCheckResult> {
  const result: ProxyCheckResult = { issues: [], warnings: [] };
  const { proxy } = input;

  if (proxy.kind === "velocity") {
    const toml = await readText(path.join(proxy.dir, "velocity.toml"));
    if (!toml) {
      result.warnings.push(
        `${proxy.name}: no velocity.toml yet; start it once, then configure [servers] and forwarding`,
      );
      return result;
    }

    const ports = listedPorts(parseVelocityServers(toml));
    for (const backend of input.backends) {
      if (!ports.has(backend.port)) {
        result.issues.push(
          `${proxy.name}: velocity.toml [servers] has no entry for ${backend.name} (port ${backend.port})`,
        );
      }
    }

    const mode =
      toml
        .match(/^\s*player-info-forwarding-mode\s*=\s*"?(\w+)"?/m)?.[1]
        ?.toLowerCase() ?? "none";
    if (mode === "modern") {
      const secretFile =
        toml.match(/^\s*forwarding-secret-file\s*=\s*"([^"]*)"/m)?.[1] ||
        "forwarding.secret";
      const secret =
        (await readText(path.join(proxy.dir, secretFile)))?.trim() ?? null;
      for (const backend of input.backends) {
        await checkModernBackend(backend, secret, result);
      }
    } else if (mode === "legacy" || mode === "bungeeguard") {
      for (const backend of input.backends) {
        await checkLegacyBackend(backend, result);
      }
    }
    return result;
  }

  if (proxy.kind === "bungeecord") {
    const config = await readText(path.join(proxy.dir, "config.yml"));
    if (!config) {
      result.warnings.push(
        `${proxy.name}: no config.yml yet; start it once, then configure servers and ip_forward`,
      );
      return result;
    }

    const ports = listedPorts(
      [...config.matchAll(/^\s*address:\s*(\S+)/gm)].map((match) => match[1]),
    );
    for (const backend of input.backends) {
      if (!ports.has(backend.port)) {
        result.issues.push(
          `${proxy.name}: config.yml servers has no address for ${backend.name} (port ${backend.port})`,
        );
      }
    }
    if (!/^ip_forward:\s*true/m.test(config)) {
      result.issues.push(`${proxy.name}: set ip_forward: true in config.yml`);
    }
    for (const backend of input.backends) {
      await checkLegacyBackend(backend, result);
    }
  }

  return result;
}
