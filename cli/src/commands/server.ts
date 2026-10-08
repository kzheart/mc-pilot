import { Command } from "commander";

import {
  listProjectServers,
  resolveServerTarget,
  ServerManager,
  type ServerTarget,
} from "../instance/ServerManager.js";
import type { CommandContext } from "../util/context.js";
import { ERROR_MESSAGES, invalidParams } from "../util/errors.js";
import { wrapCommand } from "../util/command.js";
import { resolveBackendNames } from "../util/project.js";

const DEFAULT_EXEC_WAIT_SECONDS = 2;

/** Resolve an explicit server name/dir, falling back to the profile's first backend. */
export async function resolveServerArg(
  context: CommandContext,
  explicit: string | undefined,
): Promise<ServerTarget> {
  const name =
    explicit ??
    (context.activeProfile
      ? resolveBackendNames(context.activeProfile)[0]
      : undefined);
  if (!name) {
    throw invalidParams(ERROR_MESSAGES.SERVER_NAME_REQUIRED);
  }
  return resolveServerTarget(context, name);
}

export function createServerCommand() {
  const command = new Command("server").description(
    "Run server directories (run/<name>/ in the project): start, stop, status, console commands",
  );

  command
    .command("start")
    .description(
      "Start a server and wait until it accepts connections. Checks EULA, online-mode and port first.",
    )
    .argument(
      "[name]",
      "Server name under run/, or a directory path (default: active profile's server)",
    )
    .option("--eula", "Accept the Minecraft EULA (writes eula=true)")
    .option("--no-wait", "Return right after launching instead of waiting")
    .option("--timeout <seconds>", "Seconds to wait for readiness", Number)
    .action(
      wrapCommand(
        async (
          context,
          {
            args,
            options,
          }: {
            args: (string | undefined)[];
            options: { eula?: boolean; wait?: boolean; timeout?: number };
          },
        ) => {
          const target = await resolveServerArg(context, args[0]);
          return new ServerManager().start(target, {
            eula: options.eula,
            wait: options.wait,
            timeoutSeconds: options.timeout ?? context.timeout("serverReady"),
          });
        },
      ),
    );

  command
    .command("stop")
    .description("Stop a server (console stop command first, then kill)")
    .argument(
      "[name]",
      "Server name or directory (default: active profile's server)",
    )
    .action(
      wrapCommand(async (context, { args }) => {
        const target = await resolveServerArg(context, args[0]);
        return new ServerManager().stop(target);
      }),
    );

  command
    .command("status")
    .description(
      "Show server state, port and logCursor. Without a name, lists every server under run/.",
    )
    .argument("[name]", "Server name or directory")
    .action(
      wrapCommand(async (context, { args }) => {
        const manager = new ServerManager();
        if (args[0] || !context.projectRootDir) {
          return manager.status(await resolveServerArg(context, args[0]));
        }
        const servers = [];
        for (const name of await listProjectServers(context.projectRootDir)) {
          servers.push(
            await manager.status(await resolveServerTarget(context, name)),
          );
        }
        return { servers };
      }),
    );

  command
    .command("exec")
    .description(
      "Run a console command and return the log lines it produced plus a cursor for wait-log --after",
    )
    .argument(
      "<command...>",
      'Command text (leading slash optional, e.g. "say hi" or "op TEST1")',
    )
    .option(
      "--server <name>",
      "Server name or directory (default: active profile's server)",
    )
    .option(
      "--wait <seconds>",
      `Max seconds to collect output (default: ${DEFAULT_EXEC_WAIT_SECONDS})`,
      Number,
    )
    .action(
      wrapCommand(
        async (
          context,
          {
            args,
            options,
          }: {
            args: (string | undefined)[];
            options: { server?: string; wait?: number };
          },
        ) => {
          const target = await resolveServerArg(context, options.server);
          return new ServerManager().exec(
            target,
            args
              .filter((value): value is string => value !== undefined)
              .join(" "),
            (options.wait ?? DEFAULT_EXEC_WAIT_SECONDS) * 1000,
          );
        },
      ),
    );

  return command;
}
