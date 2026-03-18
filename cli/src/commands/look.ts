import { Command } from "commander";

import { buildEntityFilter, createRequestAction } from "./request-helpers.js";

export function createLookCommand() {
  const command = new Command("look").description("Camera / view direction control");

  command
    .command("at")
    .description("Look at coordinates")
    .argument("<x>", "X coordinate")
    .argument("<y>", "Y coordinate")
    .argument("<z>", "Z coordinate")
    .action(
      createRequestAction("look.at", ({ args }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2])
      }))
    );

  command
    .command("entity")
    .description("Look at an entity")
    .option("--type <type>", "Entity type (e.g. zombie, villager)")
    .option("--name <name>", "Entity custom name")
    .option("--nearest", "Target the nearest matching entity")
    .option("--id <id>", "Entity network ID", Number)
    .option("--max-distance <distance>", "Max search distance in blocks", Number)
    .action(
      createRequestAction("look.entity", ({ options }) => ({
        filter: buildEntityFilter(options)
      }))
    );

  command
    .command("set")
    .description("Set camera angle directly")
    .requiredOption("--yaw <yaw>", "Horizontal angle (-180 to 180: 0=south, -90=east, 90=west, ±180=north)", Number)
    .requiredOption("--pitch <pitch>", "Vertical angle (-90=up, 0=horizon, 90=down)", Number)
    .action(
      createRequestAction("look.set", ({ options }) => ({
        yaw: options.yaw,
        pitch: options.pitch
      }))
    );

  return command;
}
