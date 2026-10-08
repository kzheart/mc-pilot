import assert from "node:assert/strict";
import test from "node:test";

import { buildProgram } from "../index.js";
import { buildClientSearchResults } from "./SearchCommand.js";

function collectLeafCommands() {
  const leaves: string[] = [];

  const visit = (prefix: string, command: ReturnType<typeof buildProgram>) => {
    for (const subcommand of command.commands) {
      const next = prefix
        ? `${prefix} ${subcommand.name()}`
        : subcommand.name();
      if (subcommand.commands.length === 0) {
        leaves.push(next);
        continue;
      }

      visit(next, subcommand as ReturnType<typeof buildProgram>);
    }
  };

  visit("", buildProgram());
  return leaves;
}

test("buildClientSearchResults groups loader data by Minecraft version", () => {
  const results = buildClientSearchResults({
    loader: "fabric",
  });

  assert.equal(results.length, 14);
  assert.equal(results[0]?.version, "26.2");
  assert(
    results.every(
      (entry) =>
        Array.isArray(entry.loaders) && entry.loaders[0]?.loader === "fabric",
    ),
  );
});

test("patch-only versions point at the compatible client", () => {
  const [client] = buildClientSearchResults({
    loader: "fabric",
    version: "26.1.2",
  });
  assert.equal(client?.loaders[0]?.supported, false);
  assert.match(client?.loaders[0]?.notes ?? "", /26\.1/);
});

test("buildClientSearchResults carries variant validation metadata into grouped output", () => {
  const [result] = buildClientSearchResults({
    loader: "fabric",
    version: "1.20.1",
  });

  assert.deepEqual(result, {
    version: "1.20.1",
    javaVersion: "17+",
    loaders: [
      {
        loader: "fabric",
        supported: true,
        loaderVersion: "0.16.14",
        modVersion: "0.9.1",
        validation: "verified",
      },
    ],
  });
});

test("buildClientSearchResults exposes configured Forge variants", () => {
  const [result] = buildClientSearchResults({
    loader: "forge",
    version: "1.20.2",
  });

  assert.deepEqual(result, {
    version: "1.20.2",
    javaVersion: "17+",
    loaders: [
      {
        loader: "forge",
        supported: true,
        loaderVersion: "48.1.0",
        modVersion: "0.9.1",
        validation: "verified",
      },
    ],
  });
});

test("buildClientSearchResults exposes selectable 1.12.2 Forge builds", () => {
  const [result] = buildClientSearchResults({
    loader: "forge",
    version: "1.12.2",
  });

  assert.deepEqual(result?.loaders[0]?.loaderVersions, [
    "14.23.5.2859",
    "14.23.5.2860",
    "14.23.5.2864",
  ]);
});

test("buildProgram registers discovery-oriented CLI commands", () => {
  const leaves = collectLeafCommands();

  assert.ok(leaves.includes("client search"));
  assert.ok(leaves.includes("client create"));
  assert.ok(leaves.includes("schema"));
  assert.ok(!leaves.includes("server search"));
  assert.ok(!leaves.includes("server create"));
});
