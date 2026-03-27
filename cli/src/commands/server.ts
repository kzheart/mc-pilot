import { Command } from "commander";

import { buildServerSearchResults } from "../download/SearchCommand.js";
import { downloadServerJarToCache } from "../download/server/ServerDownloader.js";
import type { ServerType } from "../download/VersionMatrix.js";
import { ServerInstanceManager } from "../instance/ServerInstanceManager.js";
import { MctError } from "../util/errors.js";
import { wrapCommand } from "../util/command.js";
import type { ServerType as InstanceServerType } from "../util/instance-types.js";

function requireProject(context: { projectName: string | null }): string {
  if (!context.projectName) {
    throw new MctError(
      { code: "NO_PROJECT", message: "No project context. Run 'mct init' first or use --project <name>" },
      4
    );
  }
  return context.projectName;
}

function resolveServerName(context: { projectName: string | null; activeProfile: { server: string } | null }, explicit?: string): string {
  if (explicit) return explicit;
  if (context.activeProfile?.server) return context.activeProfile.server;
  throw new MctError(
    { code: "INVALID_PARAMS", message: "Server name is required. Specify it as argument or set a profile." },
    4
  );
}

export function createServerCommand() {
  const command = new Command("server").description("Manage Minecraft server instances");

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
    .command("create")
    .description("Create a new server instance")
    .argument("<name>", "Server instance name (e.g. paper-1.20.4)")
    .option("--type <type>", "Server type: vanilla|paper|purpur|spigot (default: paper)")
    .option("--version <version>", "Minecraft version (default: 1.21.4)")
    .option("--build <build>", "Specific build number")
    .option("--port <number>", "Server port (auto-assigned if omitted)", Number)
    .option("--jvm-args <args>", "JVM arguments (comma-separated)")
    .option("--eula", "Auto-accept EULA")
    .action(
      wrapCommand(async (context, { args, options }: {
        args: string[];
        options: {
          type?: ServerType;
          version?: string;
          build?: string;
          port?: number;
          jvmArgs?: string;
          eula?: boolean;
        };
      }) => {
        const project = requireProject(context);
        const serverType = (options.type ?? "paper") as InstanceServerType;
        const version = options.version ?? "1.21.4";

        const downloadResult = await downloadServerJarToCache(
          { type: serverType, version, build: options.build }
        );

        const manager = new ServerInstanceManager(context.globalState, project);
        return manager.create({
          name: args[0],
          project,
          type: serverType,
          version,
          port: options.port,
          jvmArgs: options.jvmArgs?.split(",").map(a => a.trim()) ?? [],
          eula: options.eula,
          cachedJarPath: downloadResult.cachePath
        });
      })
    );

  command
    .command("start")
    .description("Start a server instance")
    .argument("[name]", "Server instance name (default: from active profile)")
    .option("--eula", "Auto-accept EULA")
    .option("--jvm-args <args>", "Override JVM arguments (comma-separated)")
    .action(
      wrapCommand(async (context, { args, options }: { args: string[]; options: { eula?: boolean; jvmArgs?: string } }) => {
        const project = requireProject(context);
        const serverName = resolveServerName(context, args[0]);
        const manager = new ServerInstanceManager(context.globalState, project);
        return manager.start(serverName, {
          eula: options.eula,
          jvmArgs: options.jvmArgs?.split(",").map(a => a.trim())
        });
      })
    );

  command
    .command("stop")
    .description("Stop a server instance")
    .argument("[name]", "Server instance name (default: from active profile)")
    .action(
      wrapCommand(async (context, { args }) => {
        const project = requireProject(context);
        const serverName = resolveServerName(context, args[0]);
        const manager = new ServerInstanceManager(context.globalState, project);
        return manager.stop(serverName);
      })
    );

  command
    .command("status")
    .description("Show server status")
    .argument("[name]", "Server instance name (omit to show all in project)")
    .action(
      wrapCommand(async (context, { args }) => {
        const project = requireProject(context);
        const manager = new ServerInstanceManager(context.globalState, project);
        return manager.status(args[0]);
      })
    );

  command
    .command("list")
    .description("List server instances")
    .option("--all", "List instances across all projects")
    .action(
      wrapCommand(async (context, { options }: { options: { all?: boolean } }) => {
        if (options.all) {
          return { instances: await ServerInstanceManager.listAll(context.globalState) };
        }
        const project = requireProject(context);
        const manager = new ServerInstanceManager(context.globalState, project);
        return { instances: await manager.list() };
      })
    );

  command
    .command("wait-ready")
    .description("Wait until server port is connectable")
    .argument("[name]", "Server instance name (default: from active profile)")
    .option("--timeout <seconds>", "Timeout in seconds", Number)
    .action(
      wrapCommand(async (context, { args, options }: { args: string[]; options: { timeout?: number } }) => {
        const project = requireProject(context);
        const serverName = resolveServerName(context, args[0]);
        const manager = new ServerInstanceManager(context.globalState, project);
        return manager.waitReady(serverName, options.timeout ?? context.timeout("serverReady"));
      })
    );

  return command;
}
