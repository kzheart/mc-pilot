import { Command } from "commander";

import { buildClientSearchResults } from "../download/SearchCommand.js";
import type { ClientLoader } from "../download/VersionMatrix.js";
import { ClientInstanceManager } from "../instance/ClientInstanceManager.js";
import { ServerInstanceManager } from "../instance/ServerInstanceManager.js";
import { MctError } from "../util/errors.js";
import { createRequestAction } from "./request-helpers.js";
import { wrapCommand } from "../util/command.js";
import { CacheManager } from "../download/CacheManager.js";
import {
  findVariantByVersionAndLoader,
  getDefaultVariant,
  getModArtifactFileName,
  loadModVariantCatalog
} from "../download/ModVariantCatalog.js";
import { detectJava } from "../download/JavaDetector.js";
import { prepareManagedFabricRuntime } from "../download/client/FabricRuntimeDownloader.js";
import { copyFileIfMissing, downloadFile } from "../download/DownloadUtils.js";
import { resolveClientInstanceDir } from "../util/paths.js";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import type { LoaderType } from "../util/instance-types.js";
import type { CommandContext } from "../util/context.js";

export async function resolveProfileServerAddress(
  context: Pick<CommandContext, "projectId" | "activeProfile" | "globalState">,
  explicitServer: string | undefined,
  loadPort?: (projectId: string, serverName: string) => Promise<number>
): Promise<string | undefined> {
  if (explicitServer) {
    return explicitServer;
  }
  if (!context.projectId || !context.activeProfile?.server) {
    return undefined;
  }

  try {
    const port = loadPort
      ? await loadPort(context.projectId, context.activeProfile.server)
      : (await new ServerInstanceManager(context.globalState, context.projectId).loadMeta(context.activeProfile.server)).port;
    return `127.0.0.1:${port}`;
  } catch {
    return undefined;
  }
}

export function createClientCommand() {
  const command = new Command("client").description("Manage Minecraft client instances");

  command
    .command("search")
    .description("Search available client version and loader combinations")
    .option("--loader <loader>", "Client loader: fabric|forge|neoforge")
    .option("--version <version>", "Minecraft version")
    .action(
      wrapCommand(async (_context, { options }: { options: { loader?: ClientLoader; version?: string } }) => {
        return {
          results: buildClientSearchResults({
            loader: options.loader,
            version: options.version
          })
        };
      })
    );

  command
    .command("create")
    .description("Create a new client instance")
    .argument("<name>", "Client instance name (e.g. fabric-1.20.4)")
    .option("--version <version>", "Minecraft version (default: 1.21.4)")
    .option("--loader <loader>", "Client loader: fabric (default: fabric)")
    .option("--ws-port <port>", "WebSocket port (auto-assigned if omitted)", Number)
    .option("--account <account>", "Offline username or account identifier")
    .option("--headless", "Launch in headless mode")
    .option("--java <command>", "Java command to use")
    .action(
      wrapCommand(async (_context, { args, options }: {
        args: (string | undefined)[];
        options: {
          version?: string;
          loader?: LoaderType;
          wsPort?: number;
          account?: string;
          headless?: boolean;
          java?: string;
        };
      }) => {
        const clientName = args[0]!;
        const loader = options.loader ?? "fabric";
        const version = options.version ?? "1.21.4";
        const cacheManager = new CacheManager();
        const catalog = await loadModVariantCatalog();
        const variant = findVariantByVersionAndLoader(catalog, version, loader);

        if (!variant) {
          throw new MctError(
            { code: "VARIANT_NOT_FOUND", message: `No mod variant found for ${version} / ${loader}` },
            4
          );
        }

        if (variant.loader !== "fabric") {
          throw new MctError(
            { code: "UNSUPPORTED_LOADER", message: `Loader ${variant.loader} is not implemented yet` },
            4
          );
        }

        // Check Java
        const java = await detectJava(options.java ?? "java");
        const requiredJava = variant.javaVersion ?? 17;
        if (!java.available || (java.majorVersion ?? 0) < requiredJava) {
          throw new MctError(
            { code: "JAVA_NOT_FOUND", message: `Java ${requiredJava}+ is required for ${variant.id}` },
            4
          );
        }

        // Resolve mod artifact
        const artifactFileName = getModArtifactFileName(variant);
        const cacheArtifactPath = cacheManager.getModFile(artifactFileName);
        const gradleModule = (variant as any).gradleModule ?? `version-${variant.minecraftVersion}`;
        const localBuildPath = path.join(process.cwd(), "client-mod", gradleModule, "build", "libs", artifactFileName);

        let sourcePath: string;
        try {
          await access(localBuildPath);
          sourcePath = localBuildPath;
          await copyFileIfMissing(localBuildPath, cacheArtifactPath);
        } catch {
          try {
            await access(cacheArtifactPath);
            sourcePath = cacheArtifactPath;
          } catch {
            const modVersion = variant.modVersion ?? "0.1.0";
            const baseUrl = process.env.MCT_MOD_DOWNLOAD_BASE_URL || "https://github.com/kzheart/mc-pilot/releases/download";
            const downloadUrl = `${baseUrl}/v${modVersion}/${artifactFileName}`;
            await downloadFile(downloadUrl, cacheArtifactPath, fetch);
            sourcePath = cacheArtifactPath;
          }
        }

        // Set up client instance directory
        const instanceDir = resolveClientInstanceDir(clientName);
        const minecraftDir = path.join(instanceDir, "minecraft");
        const modsDir = path.join(minecraftDir, "mods");
        await mkdir(modsDir, { recursive: true });
        await copyFileIfMissing(sourcePath, path.join(modsDir, artifactFileName));

        // Prepare Fabric runtime
        const runtimeRootDir = path.join(cacheManager.getRootDir(), "client", "runtime", variant.minecraftVersion);
        const managedRuntime = await prepareManagedFabricRuntime(variant, {
          runtimeRootDir,
          gameDir: minecraftDir
        }, { fetchImpl: fetch });

        const launchArgs = [
          "--runtime-root", managedRuntime.runtimeRootDir,
          "--version-id", managedRuntime.versionId,
          "--game-dir", managedRuntime.gameDir
        ];

        const manager = new ClientInstanceManager(_context.globalState);
        const meta = await manager.create({
          name: clientName,
          loader,
          version: variant.minecraftVersion,
          wsPort: options.wsPort,
          account: options.account,
          headless: options.headless,
          launchArgs,
          env: {
            MCT_CLIENT_MOD_VARIANT: variant.id,
            MCT_CLIENT_MOD_JAR: path.join(modsDir, artifactFileName)
          }
        });

        return {
          created: true,
          ...meta,
          javaCommand: java.command,
          javaVersion: java.majorVersion,
          modsDir,
          runtimeRootDir: managedRuntime.runtimeRootDir,
          runtimeVersionId: managedRuntime.versionId
        };
      })
    );

  command
    .command("launch")
    .description("Launch a client instance")
    .argument("[name]", "Client instance name (default: from active profile)")
    .option("--server <address>", "Target server address (default: active profile server, e.g. localhost:25565)")
    .option("--account <account>", "Offline username or account identifier")
    .option("--ws-port <port>", "WebSocket port override", Number)
    .option("--headless", "Launch in headless mode")
    .option("--force", "Kill any existing client with the same name before launching")
    .action(
      wrapCommand(async (
        context,
        {
          args,
          options
        }: {
          args: (string | undefined)[];
          options: { server?: string; account?: string; wsPort?: number; headless?: boolean; force?: boolean };
        }
      ) => {
        const clientName = args[0] ?? context.activeProfile?.clients[0];
        if (!clientName) {
          throw new MctError(
            { code: "INVALID_PARAMS", message: "Client name is required. Specify it as argument or set a profile." },
            4
          );
        }
        const manager = new ClientInstanceManager(context.globalState);
        const serverAddress = await resolveProfileServerAddress(context, options.server);
        return manager.launch(clientName, {
          ...options,
          server: serverAddress
        });
      })
    );

  command
    .command("stop")
    .description("Stop a client instance")
    .argument("<name>", "Client instance name")
    .action(
      wrapCommand(async (context, { args }) => {
        const manager = new ClientInstanceManager(context.globalState);
        return manager.stop(args[0]!);
      })
    );

  command
    .command("list")
    .description("List all client instances and their status")
    .action(
      wrapCommand(async (context) => {
        const manager = new ClientInstanceManager(context.globalState);
        return manager.list();
      })
    );

  command
    .command("wait-ready")
    .description("Wait until client WebSocket is connected AND the player has joined a world")
    .argument("[name]", "Client instance name (default: from active profile)")
    .option("--timeout <seconds>", "Timeout in seconds", Number)
    .option("--no-world-check", "Only wait for WebSocket connection, skip the in-world check")
    .action(
      wrapCommand(
        async (
          context,
          { args, options }: { args: (string | undefined)[]; options: { timeout?: number; worldCheck?: boolean } }
        ) => {
          const clientName = args[0] ?? context.activeProfile?.clients[0];
          if (!clientName) {
            throw new MctError(
              { code: "INVALID_PARAMS", message: "Client name is required" },
              4
            );
          }
          const manager = new ClientInstanceManager(context.globalState);
          return manager.waitReady(clientName, options.timeout ?? context.timeout("clientReady"), {
            requireWorld: options.worldCheck !== false
          });
        }
      )
    );

  command
    .command("reconnect")
    .description("Reconnect the client to the server")
    .option("--address <address>", "Target server address")
    .action(
      createRequestAction("client.reconnect", ({ options }) => ({
        address: options.address
      }))
    );

  command
    .command("respawn")
    .description("Respawn the player after death (sends C2S respawn packet, bypasses DeathScreen auto-respawn)")
    .action(createRequestAction("client.respawn", () => ({})));

  return command;
}
