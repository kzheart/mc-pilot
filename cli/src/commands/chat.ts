import { Command } from "commander";

import { ServerInstanceManager } from "../instance/ServerInstanceManager.js";
import type { CommandContext } from "../util/context.js";
import { MctError } from "../util/errors.js";
import { wrapCommand } from "../util/command.js";
import {
  createRequestAction,
  resolvePreferredClientName,
  sendClientRequest,
  withTransportTimeoutBuffer
} from "./request-helpers.js";

function normalizeChatCommand(text: string | undefined): string {
  const command = text?.trim();
  if (!command) {
    throw new MctError({ code: "INVALID_PARAMS", message: "Command is required" }, 4);
  }
  return command;
}

async function executeServerCommand(
  context: CommandContext,
  serverName: string,
  command: string
) {
  const manager = new ServerInstanceManager(context.globalState, context.projectId!);
  const result = await manager.exec(serverName, command);
  return {
    ...result,
    warning: "Commands that require a player sender should use --via client."
  };
}

export function createChatCommand() {
  const command = new Command("chat").description("Chat and server commands");

  command
    .command("send")
    .description("Send a chat message. Slash-prefixed text is routed as a player command unless --literal is set.")
    .argument("<message>", "Message text")
    .option("--literal", "Send slash-prefixed text as plain chat instead of a command packet")
    .action(
      wrapCommand(
        async (
          context,
          {
            args,
            options,
            globalOptions
          }: {
            args: (string | undefined)[];
            options: { literal?: boolean };
            globalOptions: { client?: string };
          }
        ) => {
          const message = args[0] ?? "";
          const preferredClient = resolvePreferredClientName(context, globalOptions);
          if (!options.literal && message.trim().startsWith("/")) {
            return sendClientRequest(context, preferredClient, "chat.command", { command: message });
          }
          return sendClientRequest(context, preferredClient, "chat.send", { message });
        }
      )
    );

  command
    .command("command")
    .description("Execute a command. Defaults to auto-routing: prefer player context when a client is available, otherwise use server stdin.")
    .argument("<command>", "Command text, e.g. \"gamemode creative\" (leading slash optional)")
    .option("--via <target>", "Delivery channel: auto (default), server (stdin FIFO), or client (client WS)", "auto")
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
          const via = options.via ?? "auto";
          const commandText = normalizeChatCommand(args[0]);
          const preferredClient = resolvePreferredClientName(context, globalOptions);

          if (via === "client") {
            return sendClientRequest(context, preferredClient, "chat.command", { command: commandText });
          }
          if (via === "auto") {
            if (preferredClient) {
              return sendClientRequest(context, preferredClient, "chat.command", { command: commandText });
            }
            if (!context.projectId) {
              return sendClientRequest(context, undefined, "chat.command", { command: commandText });
            }
            const serverName = options.server ?? context.activeProfile?.server;
            if (!serverName) {
              throw new MctError(
                {
                  code: "INVALID_PARAMS",
                  message: "No client context is available, and auto-routing could not resolve a server. Use --client, --server, or run inside a project profile."
                },
                4
              );
            }
            return executeServerCommand(context, serverName, commandText);
          }
          if (via !== "server") {
            throw new MctError({ code: "INVALID_PARAMS", message: `--via must be \"auto\", \"server\" or \"client\", got: ${via}` }, 4);
          }

          if (!context.projectId) {
            throw new MctError({ code: "NO_PROJECT", message: "--via server requires a project context. Use --via client or run inside an mct project." }, 4);
          }
          const serverName = options.server ?? context.activeProfile?.server;
          if (!serverName) {
            throw new MctError({ code: "INVALID_PARAMS", message: "--via server requires --server <name> or an active profile with a server." }, 4);
          }
          return executeServerCommand(context, serverName, commandText);
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

  command
    .command("clear")
    .description("Clear the cached chat history tracked by the client mod")
    .action(createRequestAction("chat.clear", () => ({})));

  return command;
}
