import { Command } from "commander";

import { ServerInstanceManager } from "../instance/ServerInstanceManager.js";
import { MctError } from "../util/errors.js";
import { wrapCommand } from "../util/command.js";
import { createRequestAction, sendClientRequest, withTransportTimeoutBuffer } from "./request-helpers.js";

export function createChatCommand() {
  const command = new Command("chat").description("Chat and server commands");

  command
    .command("send")
    .description("Send a chat message")
    .argument("<message>", "Message text")
    .action(createRequestAction("chat.send", ({ args }) => ({ message: args[0] })));

  command
    .command("command")
    .description("Execute a server command. Defaults to server stdin FIFO (reliable); use --via client to route through the client's chat.")
    .argument("<command>", "Command text, e.g. \"gamemode creative\" (leading slash optional)")
    .option("--via <target>", "Delivery channel: server (stdin FIFO, default) or client (client WS, may fail if chat disabled)", "server")
    .option("--server <name>", "Server instance name when --via server (default: active profile server)")
    .action(
      wrapCommand(
        async (
          context,
          { args, options, globalOptions }: {
            args: (string | undefined)[];
            options: { via?: string; server?: string };
            globalOptions: { client?: string };
          }
        ) => {
          const via = options.via ?? "server";
          if (via === "client") {
            return sendClientRequest(context, globalOptions.client, "chat.command", { command: args[0] });
          }
          if (via !== "server") {
            throw new MctError({ code: "INVALID_PARAMS", message: `--via must be \"server\" or \"client\", got: ${via}` }, 4);
          }

          if (!context.projectName) {
            throw new MctError({ code: "NO_PROJECT", message: "--via server requires a project context. Use --via client or run inside an mct project." }, 4);
          }
          const serverName = options.server ?? context.activeProfile?.server;
          if (!serverName) {
            throw new MctError({ code: "INVALID_PARAMS", message: "--via server requires --server <name> or an active profile with a server." }, 4);
          }
          const manager = new ServerInstanceManager(context.globalState, context.projectName);
          return manager.exec(serverName, args[0]!);
        }
      )
    );

  command
    .command("history")
    .description("Get chat history")
    .option("--last <count>", "Number of recent messages (default: 10)", Number)
    .action(createRequestAction("chat.history", ({ options }) => ({ last: options.last ?? 10 })));

  command
    .command("wait")
    .description("Wait for a chat message matching a pattern")
    .requiredOption("--match <pattern>", "Substring match by default; prefix with / for regex (e.g. /player\\d+/)")
    .option("--timeout <seconds>", "Timeout in seconds", Number)
    .action(
      createRequestAction(
        "chat.wait",
        ({ options }) => ({ match: options.match, timeout: options.timeout }),
        ({ options }, context) => withTransportTimeoutBuffer(options.timeout ? Number(options.timeout) : undefined, context.timeout("default"))
      )
    );

  command
    .command("last")
    .description("Get the last chat message")
    .action(createRequestAction("chat.last", () => ({})));

  return command;
}
