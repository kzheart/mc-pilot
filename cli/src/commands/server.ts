import { Command } from "commander";

import { buildServerSearchResults } from "../download/SearchCommand.js";
import { downloadServerJar } from "../download/server/ServerDownloader.js";
import type { ServerType } from "../download/VersionMatrix.js";
import { wrapCommand } from "../util/command.js";
import { ServerManager } from "../server/ServerManager.js";

export function createServerCommand() {
  const command = new Command("server").description("Manage Minecraft server");

  command
    .command("search")
    .description("Search available server versions")
    .option("--type <type>", "Server type: vanilla|paper|purpur|spigot")
    .option("--version <version>", "Minecraft version")
    .action(
      wrapCommand(async (_context, { options }: { options: { type?: ServerType; version?: string } }) => {
        return {
          results: buildServerSearchResults({
            type: options.type,
            version: options.version
          })
        };
      })
    );

  command
    .command("download")
    .description("Download server jar and update config")
    .option("--type <type>", "Server type: vanilla|paper|purpur|spigot")
    .option("--version <version>", "Minecraft version")
    .option("--build <build>", "Specific build number")
    .option("--dir <path>", "Download target directory")
    .option("--fixtures <path>", "Fixture plugin jar, auto-copied to plugins/")
    .action(
      wrapCommand(async (context, { options }: { options: { type?: ServerType; version?: string; build?: string; dir?: string; fixtures?: string } }) => {
        return downloadServerJar(context, options);
      })
    );

  command
    .command("start")
    .description("Start the server")
    .option("--jar <path>", "Server jar path (default: from config server.jar)")
    .option("--dir <path>", "Server directory (default: from config server.dir)")
    .option("--port <number>", "Server port (default: 25565)", Number)
    .option("--eula", "Auto-accept EULA")
    .action(
      wrapCommand(async (context, { options }) => {
        const manager = new ServerManager(context);
        return manager.start(options);
      })
    );

  command
    .command("stop")
    .description("Stop the server")
    .action(
      wrapCommand(async (context) => {
        const manager = new ServerManager(context);
        return manager.stop();
      })
    );

  command
    .command("status")
    .description("Show server status")
    .action(
      wrapCommand(async (context) => {
        const manager = new ServerManager(context);
        return manager.status();
      })
    );

  command
    .command("wait-ready")
    .description("Wait until server port is connectable")
    .option("--timeout <seconds>", "Timeout in seconds", Number)
    .action(
      wrapCommand(async (context, { options }: { options: { timeout?: number } }) => {
        const manager = new ServerManager(context);
        return manager.waitReady(options.timeout ?? context.config.timeout.serverReady);
      })
    );

  return command;
}
