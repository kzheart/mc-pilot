import { Command } from "commander";

import { createRequestAction, withTransportTimeoutBuffer } from "./request-helpers.js";

export function createChatCommand() {
  const command = new Command("chat").description("聊天与命令操作");

  command
    .command("send")
    .description("发送聊天消息")
    .argument("<message>", "聊天内容")
    .action(createRequestAction("chat.send", ({ args }) => ({ message: args[0] })));

  command
    .command("command")
    .description("执行聊天命令")
    .argument("<command>", "命令内容")
    .action(createRequestAction("chat.command", ({ args }) => ({ command: args[0] })));

  command
    .command("history")
    .description("获取聊天历史")
    .option("--last <count>", "最近消息条数", Number)
    .action(createRequestAction("chat.history", ({ options }) => ({ last: options.last ?? 10 })));

  command
    .command("wait")
    .description("等待匹配的聊天消息")
    .requiredOption("--match <pattern>", "匹配文本或正则")
    .option("--timeout <seconds>", "等待超时秒数", Number)
    .action(
      createRequestAction(
        "chat.wait",
        ({ options }) => ({ match: options.match, timeout: options.timeout }),
        ({ options }, context) => withTransportTimeoutBuffer(options.timeout ? Number(options.timeout) : undefined, context.config.timeout.default)
      )
    );

  command
    .command("last")
    .description("获取最后一条聊天消息")
    .action(createRequestAction("chat.last", () => ({})));

  return command;
}
