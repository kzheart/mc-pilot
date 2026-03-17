import assert from "node:assert/strict";
import test from "node:test";

import { buildProgram } from "../index.js";
import { buildClientSearchResults, buildServerSearchResults } from "./SearchCommand.js";

function collectLeafCommands() {
  const leaves: string[] = [];

  const visit = (prefix: string, command: ReturnType<typeof buildProgram>) => {
    for (const subcommand of command.commands) {
      const next = prefix ? `${prefix} ${subcommand.name()}` : subcommand.name();
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
    version: "1.20.4"
  });

  assert.deepEqual(results, [
    {
      type: "paper",
      versions: [{ version: "1.20.4", build: "496" }]
    }
  ]);
});

test("buildClientSearchResults groups loader data by Minecraft version", () => {
  const results = buildClientSearchResults({
    loader: "fabric"
  });

  assert.equal(results.length, 6);
  assert(
    results.every((entry) =>
      Array.isArray(entry.loaders)
      && entry.loaders[0]?.loader === "fabric"
    )
  );
});

test("buildProgram registers server/client search and download commands", () => {
  const leaves = collectLeafCommands();

  assert.ok(leaves.includes("server search"));
  assert.ok(leaves.includes("server download"));
  assert.ok(leaves.includes("client search"));
  assert.ok(leaves.includes("client download"));
});
