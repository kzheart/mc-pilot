import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "commander";

import { buildProgram } from "../index.js";
import { assertOfflineAuthGate } from "../commands/project.js";
import { attachGlobalOptions } from "./command.js";
import { requireActiveProfile, type MctProjectFile } from "./project.js";
import { MctError } from "./errors.js";

function globalOptionNames(): string[] {
  return attachGlobalOptions(new Command("probe"))
    .options.map((option) => option.long ?? "")
    .filter(Boolean);
}

function walk(
  command: Command,
  trail: string[] = [],
): Array<[string, Command]> {
  const here = [...trail, command.name()];
  return command.commands.flatMap((child) => [
    [here.concat(child.name()).join(" "), child] as [string, Command],
    ...walk(child, here),
  ]);
}

/**
 * Regression guard for the `--profile` silent-ignore bug.
 *
 * When a subcommand redeclares an option the root already owns, commander binds
 * the parsed value to the *root* command and leaves the subcommand's own
 * `opts()` empty. Any action reading `options.profile` then silently fell back
 * to `defaultProfile`, so `--profile` was ignored in every position while
 * `context.activeProfile` still reported the requested one — the two disagreed
 * and tests ran against the wrong instance.
 */
test("no subcommand redeclares a global option", () => {
  const reserved = new Set(globalOptionNames());
  assert.ok(reserved.has("--profile"), "expected --profile to be global");

  const offenders: string[] = [];
  for (const [name, command] of walk(buildProgram())) {
    for (const option of command.options) {
      if (option.long && reserved.has(option.long)) {
        offenders.push(`${name} ${option.long}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these subcommands shadow a global option, which makes commander drop the value:\n  ${offenders.join("\n  ")}`,
  );
});

const projectFile = {
  project: "demo",
  rootDir: "/tmp/demo",
  defaultProfile: "release",
  profiles: {
    release: { server: "paper", clients: [] },
    compat: { server: "paper-1122", clients: [] },
  },
} as unknown as MctProjectFile;

test("requireActiveProfile rejects an unknown profile instead of falling back", () => {
  let error!: MctError;
  assert.throws(
    () =>
      requireActiveProfile({
        projectFile,
        activeProfile: null,
        requestedProfile: "definitely-no-such-profile",
      }),
    (thrown: unknown) => {
      assert.ok(thrown instanceof MctError);
      error = thrown;
      return true;
    },
  );

  assert.equal(error.code, "NO_PROFILE");
  assert.match(error.message, /definitely-no-such-profile/);
  assert.deepEqual((error.details as { available: string[] }).available, [
    "release",
    "compat",
  ]);
});

test("requireActiveProfile reports missing selection when none was requested", () => {
  let error!: MctError;
  assert.throws(
    () => requireActiveProfile({ projectFile, activeProfile: null }),
    (thrown: unknown) => {
      assert.ok(thrown instanceof MctError);
      error = thrown;
      return true;
    },
  );

  assert.equal(error.code, "NO_PROFILE");
  assert.doesNotMatch(error.message, /not found/);
});

test("up refuses to launch offline clients against an online-mode instance", () => {
  let error!: MctError;
  assert.throws(
    () =>
      assertOfflineAuthGate({
        instance: "paper-1.20.4",
        onlineMode: true,
        isProxy: false,
        clients: ["fabric-1.20.4"],
      }),
    (thrown: unknown) => {
      assert.ok(thrown instanceof MctError);
      error = thrown;
      return true;
    },
  );

  assert.equal(error.code, "ONLINE_MODE_CONFLICT");
  assert.match(error.message, /Invalid session/);
  assert.equal(
    (error.details as { fix: string }).fix,
    "mct server config paper-1.20.4 --online-mode false",
  );
});

test("the auth gate stays out of the way for offline instances", () => {
  assert.doesNotThrow(() =>
    assertOfflineAuthGate({
      instance: "paper-1.20.4",
      onlineMode: false,
      isProxy: false,
      clients: ["fabric-1.20.4"],
    }),
  );
  assert.doesNotThrow(() =>
    assertOfflineAuthGate({
      instance: "paper-1.20.4",
      onlineMode: undefined,
      isProxy: false,
      clients: [],
    }),
  );
});

test("requireActiveProfile returns the resolved profile", () => {
  const resolved = requireActiveProfile({
    projectFile,
    activeProfile: projectFile.profiles.compat,
    requestedProfile: "compat",
  });

  assert.equal(resolved.server, "paper-1122");
});
