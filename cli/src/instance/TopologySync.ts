import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { isProxyType } from "../download/VersionMatrix.js";
import { MctError } from "../util/errors.js";
import type { ServerInstanceMeta } from "../util/instance-types.js";
import { resolveServerInstanceDir } from "../util/paths.js";
import {
  decideForwardingMode,
  ensureBackendForwarding,
  type ForwardingMode,
} from "./forwarding.js";
import { getServerFlavor } from "./server-flavor.js";
import type { ServerInstanceManager } from "./ServerInstanceManager.js";

export interface TopologyResult {
  backends: Array<{ name: string; port: number }>;
  proxy?: { name: string; port: number; forwarding: ForwardingMode };
  warnings: string[];
}

export async function syncTopology(
  manager: ServerInstanceManager,
  project: string,
  backendNames: string[],
  proxyName: string | undefined,
): Promise<TopologyResult> {
  const backendMetas: ServerInstanceMeta[] = [];
  for (const name of backendNames) {
    const meta = await manager.loadMeta(name);
    if (isProxyType(meta.type)) {
      throw new MctError(
        {
          code: "INVALID_TOPOLOGY",
          message: `Backend '${name}' is a proxy instance; put it in the 'proxy' field instead`,
        },
        4,
      );
    }
    backendMetas.push(meta);
  }

  const backends = backendNames.map((name, index) => ({
    name,
    port: backendMetas[index]!.port,
  }));

  if (proxyName === undefined) {
    return { backends, warnings: [] };
  }

  const proxyMeta = await manager.loadMeta(proxyName);
  if (!isProxyType(proxyMeta.type)) {
    throw new MctError(
      {
        code: "INVALID_TOPOLOGY",
        message: `'${proxyName}' is not a proxy instance (type: ${proxyMeta.type})`,
      },
      4,
    );
  }

  const forwarding = decideForwardingMode(
    proxyMeta.type,
    backendMetas.map((meta) => meta.mcVersion),
  );

  let secret = "";
  const proxyInstanceDir = resolveServerInstanceDir(project, proxyName);
  if (proxyMeta.type === "velocity") {
    const secretPath = path.join(proxyInstanceDir, "forwarding.secret");
    try {
      const raw = await readFile(secretPath, "utf8");
      const trimmed = raw.trim();
      if (trimmed) {
        secret = trimmed;
      } else {
        secret = randomBytes(16).toString("hex");
        await writeFile(secretPath, `${secret}\n`, "utf8");
      }
    } catch {
      secret = randomBytes(16).toString("hex");
      await writeFile(secretPath, `${secret}\n`, "utf8");
    }
  }

  const warnings: string[] = [];
  for (let index = 0; index < backendNames.length; index++) {
    const name = backendNames[index]!;
    const meta = backendMetas[index]!;
    const instanceDir = resolveServerInstanceDir(project, name);
    const backendWarnings = await ensureBackendForwarding(
      instanceDir,
      meta.type,
      meta.mcVersion,
      forwarding,
      secret,
    );
    warnings.push(...backendWarnings);
  }

  proxyMeta.proxy = {
    servers: Object.fromEntries(
      backends.map((backend) => [backend.name, `127.0.0.1:${backend.port}`]),
    ),
    try: backends.length > 0 ? [backends[0]!.name] : [],
    forwarding,
  };
  await writeFile(
    path.join(proxyInstanceDir, "instance.json"),
    `${JSON.stringify(proxyMeta, null, 2)}\n`,
    "utf8",
  );

  await getServerFlavor(proxyMeta.type).syncConfig({
    instanceDir: proxyInstanceDir,
    meta: proxyMeta,
  });

  return {
    backends,
    proxy: { name: proxyName, port: proxyMeta.port, forwarding },
    warnings,
  };
}
