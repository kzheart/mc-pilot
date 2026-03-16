import process from "node:process";
import { inspect } from "node:util";

import type { MctError } from "./errors.js";

export type OutputMode = "json" | "human";

export function printSuccess(data: unknown, mode: OutputMode) {
  if (mode === "human") {
    if (typeof data === "string") {
      process.stdout.write(`${data}\n`);
      return;
    }

    process.stdout.write(`${inspect(data, { colors: true, depth: null })}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify({ success: true, data }, null, 2)}\n`);
}

export function printError(error: MctError, mode: OutputMode) {
  if (mode === "human") {
    process.stderr.write(`[${error.code}] ${error.message}\n`);

    if (error.details && typeof error.details === "object" && Object.keys(error.details).length > 0) {
      process.stderr.write(`${inspect(error.details, { colors: true, depth: null })}\n`);
    }

    return;
  }

  process.stderr.write(`${JSON.stringify(error.toJSON(), null, 2)}\n`);
}
