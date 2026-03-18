import { Command } from "commander";

import { ClientManager } from "../client/ClientManager.js";
import { downloadClientMod } from "../download/client/ClientDownloader.js";
import { buildClientSearchResults } from "../download/SearchCommand.js";
import type { ClientLoader } from "../download/VersionMatrix.js";
import { createRequestAction } from "./request-helpers.js";
import { wrapCommand } from "../util/command.js";

export function createClientCommand() {
  const command = new Command("client").description("Manage Minecraft client");

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
    .command("download")
    .description("Download client mod and update config")
    .option("--loader <loader>", "Client loader: fabric|forge|neoforge (default: fabric)")
    .option("--version <version>", "Minecraft version (default: 1.20.4)")
    .option("--dir <path>", "Mod download directory")
    .option("--name <name>", "Client config name (default: \"default\"); use this name with \"client launch\"")
    .option("--ws-port <port>", "WebSocket port for CLI-to-mod communication (default: 25560)", Number)
    .option("--server <address>", "Default server address (e.g. localhost:25565)")
    .option("--instance-dir <path>", "Client instance directory")
    .option("--meta-dir <path>", "Runtime metadata directory")
    .option("--libraries-dir <path>", "Runtime libraries directory")
    .option("--assets-dir <path>", "Runtime assets directory")
    .option("--natives-dir <path>", "Runtime natives directory")
    .action(
      wrapCommand(
        async (
          context,
          {
            options
          }: {
            options: {
              loader?: ClientLoader;
              version?: string;
              dir?: string;
              name?: string;
              wsPort?: number;
              server?: string;
              instanceDir?: string;
              metaDir?: string;
              librariesDir?: string;
              assetsDir?: string;
              nativesDir?: string;
            };
          }
        ) => {
          return downloadClientMod(context, options);
        }
      )
    );

  command
    .command("launch")
    .description("Launch a client instance")
    .argument("<name>", "Client name (matches a key in config \"clients\", e.g. \"default\")")
    .option("--version <version>", "Minecraft version")
    .option("--server <address>", "Target server address (e.g. localhost:25565)")
    .option("--account <account>", "Offline username or account identifier")
    .option("--ws-port <port>", "WebSocket port (default: 25560)", Number)
    .option("--headless", "Launch in headless mode (window hidden)")
    .action(
      wrapCommand(async (context, { args, options }) => {
        const manager = new ClientManager(context);
        return manager.launch({
          name: args[0],
          ...options
        });
      })
    );

  command
    .command("stop")
    .description("Stop a client instance")
    .argument("<name>", "Client name")
    .action(
      wrapCommand(async (context, { args }) => {
        const manager = new ClientManager(context);
        return manager.stop(args[0]);
      })
    );

  command
    .command("list")
    .description("List all client instances and their status")
    .action(
      wrapCommand(async (context) => {
        const manager = new ClientManager(context);
        return manager.list();
      })
    );

  command
    .command("wait-ready")
    .description("Wait until client WebSocket is connected")
    .argument("<name>", "Client name")
    .option("--timeout <seconds>", "Timeout in seconds", Number)
    .action(
      wrapCommand(async (context, { args, options }) => {
        const manager = new ClientManager(context);
        return manager.waitReady(
          args[0],
          (options as { timeout?: number }).timeout ?? context.config.timeout.clientReady
        );
      })
    );

  command
    .command("reconnect")
    .description("Reconnect the client to the server")
    .option("--address <address>", "Target server address (default: from launch config)")
    .action(
      createRequestAction("client.reconnect", ({ options }) => ({
        address: options.address
      }))
    );

  return command;
}
