import { Command } from "commander";

import { createRequestAction, withTransportTimeoutBuffer } from "./request-helpers.js";

export function createChatCommand() {
  const command = new Command("chat").description("Chat and server commands");

  command
    .command("send")
    .description("Send a chat message")
    .argument("<message>", "Message text")
    .action(createRequestAction("chat.send", ({ args }) => ({ message: args[0] })));

  command
    .command("command")
    .description("Execute a server command (no / prefix needed)")
    .argument("<command>", "Command text, e.g. \"gamemode creative\"")
    .action(createRequestAction("chat.command", ({ args }) => ({ command: args[0] })));

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
        ({ options }, context) => withTransportTimeoutBuffer(options.timeout ? Number(options.timeout) : undefined, context.config.timeout.default)
      )
    );

  command
    .command("last")
    .description("Get the last chat message")
    .action(createRequestAction("chat.last", () => ({})));

  return command;
}
