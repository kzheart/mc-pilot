import { Command } from "commander";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createBlockCommand } from "./commands/block.js";
import { createBookCommand } from "./commands/book.js";
import { createClientCommand } from "./commands/client.js";
import { createChatCommand } from "./commands/chat.js";
import { createCombatCommand } from "./commands/combat.js";
import { createAnvilCommand, createCraftCommand, createEnchantCommand, createTradeCommand } from "./commands/craft.js";
import { createEntityCommand } from "./commands/entity.js";
import { createEventsCommand } from "./commands/events.js";
import { createGuiCommand } from "./commands/gui.js";
import { createHudCommand } from "./commands/hud.js";
import { createInputCommand } from "./commands/input.js";
import { createInventoryCommand } from "./commands/inventory.js";
import { createLookCommand } from "./commands/look.js";
import { createMoveCommand } from "./commands/move.js";
import { createPositionCommand } from "./commands/position.js";
import { createResourcepackCommand } from "./commands/resourcepack.js";
import { createRotationCommand } from "./commands/rotation.js";
import { createScreenCommand } from "./commands/screen.js";
import { createScreenshotCommand } from "./commands/screenshot.js";
import { createSchemaCommand } from "./commands/schema.js";
import { createServerCommand } from "./commands/server.js";
import { createSignCommand } from "./commands/sign.js";
import { createStatusCommand } from "./commands/status.js";
import { createWaitCommand } from "./commands/wait.js";
import { createPluginCommand } from "./commands/plugin.js";
import { createInitCommand, createDeployCommand, createUpCommand, createDownCommand, createUseCommand } from "./commands/project.js";
import { attachGlobalOptions, wrapCommand } from "./util/command.js";

export function buildProgram() {
  const program = new Command();

  program
    .name("mct")
    .description(
        "MC Pilot – Minecraft plugin/mod automated testing CLI\n\n" +
        "Control a real Minecraft client via CLI to simulate player actions and verify plugin behavior.\n" +
        "All commands output JSON by default. Use --human for human-readable output.\n\n" +
        "Quick start:\n" +
        "  mct init --name my-plugin\n" +
        "  mct server create paper-1.20.4 --type paper --version 1.20.4\n" +
        "  mct client create fabric-1.20.4 --version 1.20.4\n" +
        "  mct up --profile 1.20\n" +
        "  mct chat command \"gamemode creative\"\n" +
        "  mct move to 100 64 100\n" +
        "  mct screenshot --output ./test.png\n" +
        "  mct down"
    )
    .version(
      JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")).version,
      "--cli-version",
      "Show CLI version"
    );

  attachGlobalOptions(program);

  program
    .command("info")
    .description("Show current project and global state")
    .action(
      wrapCommand(async (context) => {
        return {
          cwd: context.cwd,
          projectId: context.projectId,
          project: context.projectName,
          projectRootDir: context.projectRootDir,
          projectConfigPath: context.projectConfigPath,
          activeProfile: context.activeProfile,
          globalStateDir: context.globalState.getRootDir()
        };
      })
    );

  // Project lifecycle commands
  program.addCommand(createInitCommand());
  program.addCommand(createDeployCommand());
  program.addCommand(createUpCommand());
  program.addCommand(createDownCommand());
  program.addCommand(createUseCommand());

  // Instance management
  program.addCommand(createServerCommand());
  program.addCommand(createClientCommand());
  program.addCommand(createPluginCommand());
  program.addCommand(createSchemaCommand(() => program));

  // Game interaction commands
  program.addCommand(createChatCommand());
  program.addCommand(createInputCommand());
  program.addCommand(createMoveCommand());
  program.addCommand(createLookCommand());
  program.addCommand(createPositionCommand());
  program.addCommand(createRotationCommand());
  program.addCommand(createBlockCommand());
  program.addCommand(createEntityCommand());
  program.addCommand(createInventoryCommand());
  program.addCommand(createGuiCommand());
  program.addCommand(createScreenshotCommand());
  program.addCommand(createScreenCommand());
  program.addCommand(createHudCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createSignCommand());
  program.addCommand(createBookCommand());
  program.addCommand(createResourcepackCommand());
  program.addCommand(createCombatCommand());
  program.addCommand(createCraftCommand());
  program.addCommand(createAnvilCommand());
  program.addCommand(createEnchantCommand());
  program.addCommand(createTradeCommand());
  program.addCommand(createWaitCommand());
  program.addCommand(createEventsCommand());

  return program;
}

const program = buildProgram();

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  program.parseAsync(process.argv);
}
