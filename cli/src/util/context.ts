import process from "node:process";

import { loadConfig, resolveConfigPath, type MctConfig } from "./config.js";
import { type OutputMode } from "./output.js";
import { resolveStateDir, StateStore } from "./state.js";

export interface GlobalOptions {
  human?: boolean;
  config?: string;
  stateDir?: string;
  client?: string;
}

export interface CommandContext {
  cwd: string;
  configPath: string;
  config: MctConfig;
  state: StateStore;
  outputMode: OutputMode;
}

export async function createCommandContext(options: GlobalOptions): Promise<CommandContext> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(options.config, cwd);
  const config = await loadConfig(configPath, cwd);
  const state = new StateStore(resolveStateDir(options.stateDir, cwd));

  return {
    cwd,
    configPath,
    config,
    state,
    outputMode: options.human ? "human" : "json"
  };
}
