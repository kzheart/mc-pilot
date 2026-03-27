import { Command } from "commander";

import { createRequestAction, withTransportTimeoutBuffer } from "./request-helpers.js";

export function createWaitCommand() {
  return new Command("wait")
    .description("Wait and synchronization")
    .argument("[seconds]", "Wait for a number of seconds")
    .option("--ticks <ticks>", "Wait for a number of game ticks", Number)
    .option("--until-health-above <value>", "Wait until health is above this value", Number)
    .option("--until-gui-open", "Wait until a GUI opens")
    .option("--until-on-ground", "Wait until the player is on the ground")
    .option("--timeout <seconds>", "Timeout in seconds", Number)
    .action(
      createRequestAction(
        "wait.perform",
        ({ args, options }) => ({
          seconds: args[0] ? Number(args[0]) : undefined,
          ticks: options.ticks,
          untilHealthAbove: options.untilHealthAbove,
          untilGuiOpen: Boolean(options.untilGuiOpen),
          untilOnGround: Boolean(options.untilOnGround),
          timeout: options.timeout
        }),
        ({ options, args }, context) => {
          const requested =
            options.timeout ? Number(options.timeout) : args[0] ? Number(args[0]) : context.timeout("default");
          return withTransportTimeoutBuffer(requested, context.timeout("default"));
        }
      )
    );
}
