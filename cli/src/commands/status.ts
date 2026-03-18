import { Command } from "commander";

import { createRequestAction } from "./request-helpers.js";

export function createStatusCommand() {
  const command = new Command("status").description("Player status queries");

  const statusLabels = {
    health: "Get health and hunger",
    effects: "Get active potion effects",
    experience: "Get XP level and progress",
    gamemode: "Get current game mode",
    world: "Get current world info",
    all: "Get all status at once"
  } as const;

  for (const sub of ["health", "effects", "experience", "gamemode", "world", "all"] as const) {
    command.command(sub).description(statusLabels[sub]).action(createRequestAction(`status.${sub}`, () => ({})));
  }

  return command;
}
