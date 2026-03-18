import process from "node:process";
import type { Command } from "commander";

import { createCommandContext, type GlobalOptions } from "./context.js";
import { normalizeError } from "./errors.js";
import { printError, printSuccess } from "./output.js";

export type CommandAction<TOptions = Record<string, unknown>> = (
  context: Awaited<ReturnType<typeof createCommandContext>>,
  payload: {
    args: string[];
    options: TOptions;
    command: Command;
    globalOptions: GlobalOptions;
  }
) => Promise<unknown>;

export function attachGlobalOptions(command: Command) {
  return command
    .option("--human", "Human-readable output (default: JSON)")
    .option("--config <path>", "Config file path (default: ./mct.config.json)")
    .option("--state-dir <path>", "State directory (default: ./.mct-state/)")
    .option("--client <name>", "Target client name (required when multiple clients are running)");
}

export function wrapCommand<TOptions = Record<string, unknown>>(action: CommandAction<TOptions>) {
  return async function wrappedCommand(this: Command, ...input: unknown[]) {
    const command = input.at(-1) as Command;
    const options = input.at(-2) as TOptions;
    const args = input.slice(0, -2).map((value) => String(value));
    const globalOptions = command.optsWithGlobals() as GlobalOptions;

    try {
      const context = await createCommandContext(globalOptions);
      const result = await action(context, {
        args,
        options,
        command,
        globalOptions
      });
      printSuccess(result, context.outputMode);
    } catch (error) {
      const normalized = normalizeError(error);
      const mode = globalOptions.human ? "human" : "json";
      printError(normalized, mode);
      process.exitCode = normalized.exitCode;
    }
  };
}
