#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkProtocolSync } from "./protocol-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const report = await checkProtocolSync(root);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  (report.success ? process.stdout : process.stderr).write(output);
  if (!report.success) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ success: false, error: error instanceof Error ? error.stack : String(error) }, null, 2)}\n`);
  process.exitCode = 1;
}
