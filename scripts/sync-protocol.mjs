#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { syncPackagedProtocol } from "./protocol-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.stdout.write(`${JSON.stringify(await syncPackagedProtocol(root), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ success: false, error: error instanceof Error ? error.stack : String(error) }, null, 2)}\n`);
  process.exitCode = 1;
}
