import { Command } from "commander";

import { buildEntityFilter, createRequestAction, withTransportTimeoutBuffer } from "./request-helpers.js";

export function createCombatCommand() {
  const command = new Command("combat").description("Combat combo operations");

  const combatActionLabels = {
    kill: "Attack target repeatedly until it dies",
    engage: "Approach and attack target once",
    chase: "Chase target without attacking"
  } as const;

  for (const actionName of ["kill", "engage", "chase"] as const) {
    command
      .command(actionName)
      .description(combatActionLabels[actionName])
      .option("--type <type>", "Entity type (e.g. zombie, skeleton)")
      .option("--name <name>", "Entity custom name")
      .option("--nearest", "Target the nearest matching entity")
      .option("--id <id>", "Entity network ID", Number)
      .option("--max-distance <distance>", "Max search distance in blocks", Number)
      .option("--timeout <seconds>", "Timeout in seconds (default: 30)", Number)
      .action(
        createRequestAction(
          `combat.${actionName}`,
          ({ options }) => ({
            filter: buildEntityFilter(options),
            timeout: options.timeout
          }),
          ({ options }, context) =>
            withTransportTimeoutBuffer(options.timeout ? Number(options.timeout) : 30, context.config.timeout.default)
        )
      );
  }

  command
    .command("clear")
    .description("Kill all entities of a type within radius")
    .requiredOption("--type <type>", "Entity type (e.g. zombie)")
    .option("--radius <radius>", "Search radius in blocks (default: 16)", Number)
    .option("--timeout <seconds>", "Timeout in seconds (default: 60)", Number)
    .action(
      createRequestAction(
        "combat.clear",
        ({ options }) => ({
          type: options.type,
          radius: options.radius ?? 16,
          timeout: options.timeout
        }),
        ({ options }, context) =>
          withTransportTimeoutBuffer(options.timeout ? Number(options.timeout) : 60, context.config.timeout.default)
      )
    );

  command
    .command("pickup")
    .description("Pick up nearby dropped items")
    .option("--radius <radius>", "Pickup radius in blocks (default: 5)", Number)
    .option("--timeout <seconds>", "Timeout in seconds (default: 10)", Number)
    .action(
      createRequestAction(
        "combat.pickup",
        ({ options }) => ({
          radius: options.radius ?? 5,
          timeout: options.timeout
        }),
        ({ options }, context) =>
          withTransportTimeoutBuffer(options.timeout ? Number(options.timeout) : 10, context.config.timeout.default)
      )
    );

  return command;
}
