import assert from "node:assert/strict";
import test from "node:test";

import { buildProgram } from "../index.js";
import {
  buildClientSearchResults,
  buildServerSearchResults,
} from "./SearchCommand.js";

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

test("buildServerSearchResults groups filtered Paper versions", () => {
  const results = buildServerSearchResults({
    type: "paper",
    version: "1.20.4",
  });

  assert.deepEqual(results, [
    {
      type: "paper",
      versions: [{ version: "1.20.4", build: "496" }],
    },
  ]);
});

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

test("search exposes verified cross-patch client and server pairings", () => {
  assert.deepEqual(
    buildServerSearchResults({ type: "paper", version: "26.1.2" }),
    [
      {
        type: "paper",
        versions: [
          {
            version: "26.1.2",
            build: "74",
            verifiedClients: [
              { minecraftVersion: "26.1", loader: "fabric", build: 74 },
            ],
          },
        ],
      },
    ],
  );

  const [client] = buildClientSearchResults({
    loader: "fabric",
    version: "26.1",
  });
  assert.deepEqual(client?.loaders[0]?.verifiedServers, [
    { type: "paper", minecraftVersion: "26.1.2", build: 74 },
    { type: "paper", minecraftVersion: "26.1.1", build: 29 },
    { type: "vanilla", minecraftVersion: "26.1" },
  ]);
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
        validation: "limited",
      },
    ],
  });
});

test("buildProgram registers discovery-oriented CLI commands", () => {
  const leaves = collectLeafCommands();

  assert.ok(leaves.includes("server search"));
  assert.ok(leaves.includes("server create"));
  assert.ok(leaves.includes("client search"));
  assert.ok(leaves.includes("client create"));
  assert.ok(leaves.includes("schema"));
});

test("server search without filter includes proxy entries", () => {
  const results = buildServerSearchResults();

  const velocity = results.find((entry) => entry.type === "velocity");
  const bungeecord = results.find((entry) => entry.type === "bungeecord");

  assert.ok(velocity);
  assert.ok(bungeecord);
  assert.deepEqual(velocity?.versions[0], {
    version: "3.4.0",
    build: "566",
  });
});

test("server search with proxy type returns single entry", () => {
  const results = buildServerSearchResults({ type: "velocity" });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.type, "velocity");
});

test("server search with version filter excludes proxies", () => {
  const results = buildServerSearchResults({ version: "1.21.4" });

  assert.equal(
    results.some((entry) => entry.type === "velocity"),
    false,
  );
  assert.equal(
    results.some((entry) => entry.type === "bungeecord"),
    false,
  );
});
