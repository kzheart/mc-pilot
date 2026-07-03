#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), "..");
const PROTOCOL_DIR = path.join(ROOT_DIR, "protocol");
const HANDLER_DIR = path.join(
  ROOT_DIR,
  "client-mod",
  "shared",
  "java",
  "com",
  "mct",
  "core",
  "handler",
);

const CASE_LINE_ACTION_PATTERN =
  /(?:case|,)\s+"([a-z]+\.[a-z0-9]+(?:[.-][a-z0-9]+)*)"\s*(?=,|->|:)/g;
const EQUALS_ACTION_PATTERN =
  /action\.equals\("([a-z]+\.[a-z0-9]+(?:[.-][a-z0-9]+)*)"\)/g;
const IGNORED_PROTOCOL_NAMES = new Set([
  "channel.listen",
  "channel.send",
  "effects.particles",
  "effects.sounds",
]);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function collectProtocolNames(document, key) {
  const entries = document[key] ?? [];
  return entries.map((entry) => entry.name).filter(Boolean);
}

async function collectProtocolActions() {
  const actions = await readJson(path.join(PROTOCOL_DIR, "actions.json"));
  const queries = await readJson(path.join(PROTOCOL_DIR, "queries.json"));
  return new Set([
    ...collectProtocolNames(actions, "actions"),
    ...collectProtocolNames(queries, "queries"),
  ]);
}

async function collectJavaActions() {
  const files = (await readdir(HANDLER_DIR))
    .filter((name) => name.endsWith(".java"))
    .map((name) => path.join(HANDLER_DIR, name));
  const actions = new Set();

  for (const filePath of files) {
    const source = await readFile(filePath, "utf8");
    for (const line of source.split("\n")) {
      if (!line.includes("case")) {
        continue;
      }
      for (const match of line.matchAll(CASE_LINE_ACTION_PATTERN)) {
        actions.add(match[1]);
      }
    }
    for (const match of source.matchAll(EQUALS_ACTION_PATTERN)) {
      actions.add(match[1]);
    }
  }

  return actions;
}

function diff(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

async function main() {
  const protocolActions = await collectProtocolActions();
  const javaActions = await collectJavaActions();
  const effectiveProtocolActions = new Set(
    [...protocolActions].filter((name) => !IGNORED_PROTOCOL_NAMES.has(name)),
  );

  const missingInJava = diff(effectiveProtocolActions, javaActions);
  const missingInProtocol = diff(javaActions, protocolActions);

  const report = {
    success: missingInJava.length === 0 && missingInProtocol.length === 0,
    ignoredProtocolNames: [...IGNORED_PROTOCOL_NAMES].sort(),
    counts: {
      protocol: protocolActions.size,
      java: javaActions.size,
    },
    missingInJava,
    missingInProtocol,
  };

  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (report.success) {
    process.stdout.write(output);
    return;
  }

  process.stderr.write(output);
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        success: false,
        error: error instanceof Error ? error.stack : String(error),
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
});
