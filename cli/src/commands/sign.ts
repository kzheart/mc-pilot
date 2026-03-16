import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createSignCommand() {
  const command = new Command("sign").description("告示牌操作");

  command
    .command("read")
    .description("读取告示牌")
    .argument("<x>")
    .argument("<y>")
    .argument("<z>")
    .action(
      createRequestAction("sign.read", ({ args }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2])
      }))
    );

  command
    .command("edit")
    .description("编辑告示牌")
    .argument("<x>")
    .argument("<y>")
    .argument("<z>")
    .requiredOption("--lines <lines...>", "四行文本")
    .action(
      createRequestAction("sign.edit", ({ args, options }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2]),
        lines: options.lines
      }))
    );

  return command;
}
