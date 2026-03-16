import { Command } from "commander";

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

program.parseAsync(process.argv);
