import { Command } from "commander";

import { buildClientSearchResults } from "../download/SearchCommand.js";
import type { ClientLoader } from "../download/VersionMatrix.js";
import { ClientInstanceManager } from "../instance/ClientInstanceManager.js";
import { ServerInstanceManager } from "../instance/ServerInstanceManager.js";
import { MctError } from "../util/errors.js";
import { createRequestAction } from "./request-helpers.js";
import { wrapCommand } from "../util/command.js";
import { downloadClientModToDir } from "../download/client/ClientDownloader.js";
import { resolveClientInstanceDir } from "../util/paths.js";
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
    .option("--loader <loader>", "Client loader: fabric|forge (default: fabric)")
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
        const instanceDir = resolveClientInstanceDir(clientName);
        const downloaded = await downloadClientModToDir(process.cwd(), instanceDir, {
          version,
          loader,
          java: options.java
        });

        const manager = new ClientInstanceManager(_context.globalState);
        const meta = await manager.create({
          name: clientName,
          loader: downloaded.loader,
          version: downloaded.minecraftVersion,
          wsPort: options.wsPort,
          account: options.account,
          headless: options.headless,
          launchArgs: downloaded.launchArgs,
          env: {
            MCT_CLIENT_MOD_VARIANT: downloaded.variantId,
            MCT_CLIENT_MOD_JAR: downloaded.jar
          }
        });

        return {
          created: true,
          ...meta,
          javaCommand: downloaded.javaCommand,
          javaVersion: downloaded.javaVersion,
          modsDir: downloaded.modsDir,
          runtimeRootDir: downloaded.runtimeRootDir,
          runtimeVersionId: downloaded.runtimeVersionId
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
