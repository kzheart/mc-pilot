import { Command } from "commander";

import { buildEntityFilter, createRequestAction } from "./request-helpers.js";

export function createLookCommand() {
  const command = new Command("look").description("视角控制");

  command
    .command("at")
    .description("看向坐标")
    .argument("<x>", "X 坐标")
    .argument("<y>", "Y 坐标")
    .argument("<z>", "Z 坐标")
    .action(
      createRequestAction("look.at", ({ args }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2])
      }))
    );

  command
    .command("entity")
    .description("看向实体")
    .option("--type <type>", "实体类型")
    .option("--name <name>", "实体名称")
    .option("--nearest", "使用最近实体")
    .option("--id <id>", "实体 ID", Number)
    .option("--max-distance <distance>", "最大距离", Number)
    .action(
      createRequestAction("look.entity", ({ options }) => ({
        filter: buildEntityFilter(options)
      }))
    );

  command
    .command("set")
    .description("设置视角")
    .requiredOption("--yaw <yaw>", "水平视角", Number)
    .requiredOption("--pitch <pitch>", "俯仰视角", Number)
    .action(
      createRequestAction("look.set", ({ options }) => ({
        yaw: options.yaw,
        pitch: options.pitch
      }))
    );

  return command;
}
