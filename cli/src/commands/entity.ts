import { Command } from "commander";

import { buildEntityFilter, createRequestAction } from "./request-helpers.js";

export function createEntityCommand() {
  const command = new Command("entity").description("Entity interaction");

  const entityActionLabels = {
    attack: "Attack an entity",
    interact: "Interact with an entity (right-click)",
    mount: "Mount an entity"
  } as const;

  for (const actionName of ["attack", "interact", "mount"] as const) {
    command
      .command(actionName)
      .description(entityActionLabels[actionName])
      .option("--type <type>", "Entity type (e.g. zombie, villager)")
      .option("--name <name>", "Entity custom name")
      .option("--nearest", "Target the nearest matching entity")
      .option("--id <id>", "Entity network ID", Number)
      .option("--max-distance <distance>", "Max search distance in blocks", Number)
      .action(
        createRequestAction(`entity.${actionName}`, ({ options }) => ({
          filter: buildEntityFilter(options)
        }))
      );
  }

  command
    .command("list")
    .description("List nearby entities")
    .option("--radius <radius>", "Search radius in blocks (default: 10)", Number)
    .action(createRequestAction("entity.list", ({ options }) => ({ radius: options.radius ?? 10 })));

  command
    .command("info")
    .description("Get detailed entity info")
    .requiredOption("--id <id>", "Entity network ID", Number)
    .action(createRequestAction("entity.info", ({ options }) => ({ id: options.id })));

  command
    .command("dismount")
    .description("Dismount from current vehicle")
    .action(createRequestAction("entity.dismount", () => ({})));

  command
    .command("steer")
    .description("Steer a mounted vehicle (flags can be combined)")
    .option("--forward", "Move forward")
    .option("--back", "Move backward")
    .option("--left", "Turn left")
    .option("--right", "Turn right")
    .option("--jump", "Jump")
    .option("--sneak", "Sneak / dismount")
    .action(
      createRequestAction("entity.steer", ({ options }) => ({
        forward: options.forward ? 1 : options.back ? -1 : 0,
        sideways: options.left ? 1 : options.right ? -1 : 0,
        jump: Boolean(options.jump),
        sneak: Boolean(options.sneak)
      }))
    );

  return command;
}
