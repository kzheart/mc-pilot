/**
 * The single process.platform check that selects the active platform
 * adapter. Consumers import `platform` and stay platform-agnostic.
 */
import process from "node:process";

import { posixAdapter } from "./posix.js";
import { windowsAdapter } from "./windows.js";
import type { PlatformAdapter } from "./types.js";

export type {
  PlatformAdapter,
  ProcessControl,
  ServerSpawnSpec,
  ServerStdinChannel,
} from "./types.js";

export const platform: PlatformAdapter =
  process.platform === "win32" ? windowsAdapter : posixAdapter;
