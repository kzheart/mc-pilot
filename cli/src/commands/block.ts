import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createBlockCommand() {
  const command = new Command("block").description("Block interaction");

  command
    .command("break")
    .description("Break a block")
    .argument("<x>", "X coordinate")
    .argument("<y>", "Y coordinate")
    .argument("<z>", "Z coordinate")
    .action(
      createRequestAction("block.break", ({ args }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2])
      }))
    );

  command
    .command("place")
    .description("Place the held block at the given position")
    .argument("<x>", "X coordinate")
    .argument("<y>", "Y coordinate")
    .argument("<z>", "Z coordinate")
    .requiredOption("--face <face>", "Block face to place against: up|down|north|south|east|west")
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
    .description("Right-click a block (e.g. open chest, crafting table, door)")
    .argument("<x>", "X coordinate")
    .argument("<y>", "Y coordinate")
    .argument("<z>", "Z coordinate")
    .action(
      createRequestAction("block.interact", ({ args }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2])
      }))
    );

  command
    .command("get")
    .description("Query block info at coordinates")
    .argument("<x>", "X coordinate")
    .argument("<y>", "Y coordinate")
    .argument("<z>", "Z coordinate")
    .action(
      createRequestAction("block.get", ({ args }) => ({
        x: Number(args[0]),
        y: Number(args[1]),
        z: Number(args[2])
      }))
    );

  return command;
}
