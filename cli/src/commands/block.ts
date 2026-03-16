import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createBlockCommand() {
  const command = new Command("block").description("方块交互");

  command
    .command("break")
    .description("破坏方块")
    .argument("<x>")
    .argument("<y>")
    .argument("<z>")
    .action(
      createRequestAction("block.break", ({ args }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2])
      }))
    );

  command
    .command("place")
    .description("放置方块")
    .argument("<x>")
    .argument("<y>")
    .argument("<z>")
    .requiredOption("--face <face>", "放置面")
    .action(
      createRequestAction("block.place", ({ args, options }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2]),
        face: options.face
      }))
    );

  command
    .command("interact")
    .description("右键交互方块")
    .argument("<x>")
    .argument("<y>")
    .argument("<z>")
    .action(
      createRequestAction("block.interact", ({ args }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2])
      }))
    );

  command
    .command("get")
    .description("查询方块")
    .argument("<x>")
    .argument("<y>")
    .argument("<z>")
    .action(
      createRequestAction("block.get", ({ args }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2])
      }))
    );

  return command;
}
