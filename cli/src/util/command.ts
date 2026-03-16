import process from "node:process";
import type { Command } from "commander";

import { createCommandContext, type GlobalOptions } from "./context.js";
import { normalizeError } from "./errors.js";
import { printError, printSuccess } from "./output.js";

export type CommandAction<TOptions = Record<string, unknown>> = (
  context: Awaited<ReturnType<typeof createCommandContext>>,
  options: TOptions
) => Promise<unknown>;

export function attachGlobalOptions(command: Command) {
  return command
    .option("--human", "输出人类可读格式")
    .option("--config <path>", "指定配置文件路径")
    .option("--state-dir <path>", "指定状态目录");
}

export function wrapCommand<TOptions = Record<string, unknown>>(action: CommandAction<TOptions>) {
  return async function wrappedCommand(this: Command, options: TOptions) {
    const globalOptions = this.optsWithGlobals() as GlobalOptions;

    try {
      const context = await createCommandContext(globalOptions);
      const result = await action(context, options);
      printSuccess(result, context.outputMode);
    } catch (error) {
      const normalized = normalizeError(error);
      const mode = globalOptions.human ? "human" : "json";
      printError(normalized, mode);
      process.exitCode = normalized.exitCode;
    }
  };
}
