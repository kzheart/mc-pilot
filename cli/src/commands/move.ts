import { Command } from "commander";

import { createRequestAction, withTransportTimeoutBuffer } from "./request-helpers.js";

export function createMoveCommand() {
  const command = new Command("move").description("Movement control");

  command
    .command("to")
    .description("Move to coordinates (straight-line walk, may get stuck on obstacles; times out after 30s)")
    .argument("<x>", "X coordinate")
    .argument("<y>", "Y coordinate")
    .argument("<z>", "Z coordinate")
    .action(
      createRequestAction(
        "move.to",
        ({ args }) => ({
          x: Number(args[0]),
          y: Number(args[1]),
          z: Number(args[2])
        }),
        (_payload, context) => withTransportTimeoutBuffer(30, context.config.timeout.default)
      )
    );

  const directionLabels = { forward: "Move forward", back: "Move backward", left: "Move left", right: "Move right" } as const;

  for (const direction of ["forward", "back", "left", "right"] as const) {
    command
      .command(direction)
      .description(directionLabels[direction])
      .argument("<blocks>", "Distance in blocks (supports decimals)")
      .action(
        createRequestAction(
          "move.direction",
          ({ args }) => ({
            direction,
            blocks: Number(args[0])
          }),
          ({ args }, context) => {
            const blocks = Math.abs(Number(args[0]));
            const timeout = Math.max(1.5, blocks * 2.0);
            return withTransportTimeoutBuffer(timeout, context.config.timeout.default);
          }
        )
      );
  }

  command
    .command("jump")
    .description("Jump once")
    .action(createRequestAction("move.jump", () => ({})));

  command
    .command("sneak")
    .description("Toggle sneaking")
    .argument("<state>", "on/off")
    .action(
      createRequestAction("move.sneak", ({ args }) => ({
        enabled: args[0] === "on"
      }))
    );

  command
    .command("sprint")
    .description("Toggle sprinting")
    .argument("<state>", "on/off")
    .action(
      createRequestAction("move.sprint", ({ args }) => ({
        enabled: args[0] === "on"
      }))
    );

  return command;
}
