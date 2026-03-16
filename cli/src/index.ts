import { Command } from "commander";

import { createBlockCommand } from "./commands/block.js";
import { createBookCommand } from "./commands/book.js";
import { createChannelCommand } from "./commands/channel.js";
import { createClientCommand } from "./commands/client.js";
import { createChatCommand } from "./commands/chat.js";
import { createAnvilCommand, createCraftCommand, createEnchantCommand, createTradeCommand } from "./commands/craft.js";
import { createEffectsCommand } from "./commands/effects.js";
import { createEntityCommand } from "./commands/entity.js";
import { createGuiCommand } from "./commands/gui.js";
import { createHudCommand } from "./commands/hud.js";
import { createInventoryCommand } from "./commands/inventory.js";
import { createLookCommand } from "./commands/look.js";
import { createMoveCommand } from "./commands/move.js";
import { createPositionCommand } from "./commands/position.js";
import { createResourcepackCommand } from "./commands/resourcepack.js";
import { createRotationCommand } from "./commands/rotation.js";
import { createScreenCommand } from "./commands/screen.js";
import { createScreenshotCommand } from "./commands/screenshot.js";
import { createServerCommand } from "./commands/server.js";
import { createSignCommand } from "./commands/sign.js";
import { createStatusCommand } from "./commands/status.js";
import { createWaitCommand } from "./commands/wait.js";
import { attachGlobalOptions, wrapCommand } from "./util/command.js";

const program = new Command();

program
  .name("mct")
  .description("Minecraft Auto Test CLI")
  .version("0.1.0");

attachGlobalOptions(program);

program
  .command("config-show")
  .description("显示当前生效配置与状态目录")
  .action(
    wrapCommand(async (context) => {
      return {
        cwd: context.cwd,
        stateDir: context.state.getRootDir(),
        config: context.config
      };
    })
  );

program.addCommand(createServerCommand());
program.addCommand(createClientCommand());
program.addCommand(createChatCommand());
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
program.addCommand(createChannelCommand());
program.addCommand(createResourcepackCommand());
program.addCommand(createEffectsCommand());
program.addCommand(createCraftCommand());
program.addCommand(createAnvilCommand());
program.addCommand(createEnchantCommand());
program.addCommand(createTradeCommand());
program.addCommand(createWaitCommand());

program.parseAsync(process.argv);
