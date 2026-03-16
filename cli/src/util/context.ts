import process from "node:process";

import { loadConfig, type MctConfig } from "./config.js";
import { type OutputMode } from "./output.js";
import { resolveStateDir, StateStore } from "./state.js";

export interface GlobalOptions {
  human?: boolean;
  config?: string;
  stateDir?: string;
}

export interface CommandContext {
  cwd: string;
  config: MctConfig;
  state: StateStore;
  outputMode: OutputMode;
}

export async function createCommandContext(options: GlobalOptions): Promise<CommandContext> {
  const cwd = process.cwd();
  const config = await loadConfig(options.config, cwd);
  const state = new StateStore(resolveStateDir(options.stateDir, cwd));

  return {
    cwd,
    config,
    state,
    outputMode: options.human ? "human" : "json"
  };
}
