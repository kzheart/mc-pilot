import { Command } from "commander";

import { createRequestAction, parseJson } from "./request-helpers.js";

export function createChannelCommand() {
  const command = new Command("channel").description("Plugin Channel");

  command
    .command("send")
    .description("发送频道消息")
    .argument("<channel>", "频道名称")
    .requiredOption("--data <json>", "JSON 数据")
    .action(
      createRequestAction("channel.send", ({ args, options }) => ({
        channel: args[0],
        data: parseJson(String(options.data), "data")
      }))
    );

  command
    .command("listen")
    .description("监听频道消息")
    .argument("<channel>", "频道名称")
    .option("--timeout <seconds>", "等待超时秒数", Number)
    .action(
      createRequestAction(
        "channel.listen",
        ({ args, options }) => ({
          channel: args[0],
          timeout: options.timeout
        }),
        ({ options }) => (options.timeout ? Number(options.timeout) : undefined)
      )
    );

  return command;
}
