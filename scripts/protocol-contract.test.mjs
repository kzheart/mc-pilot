import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  HANDLER_FAMILIES,
  PROTOCOL_FILES,
  checkProtocolSync,
  compareHandlerContract,
  extractHandlerActions,
  syncPackagedProtocol,
} from "./protocol-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mct-protocol-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "protocol"));
  for (const file of PROTOCOL_FILES) {
    const key = path.basename(file, ".json");
    const entries = key === "actions"
      ? [{ name: "chat.send", params: ["message"] }]
      : key === "queries"
        ? [{ name: "status.all", params: [] }]
        : [{ code: "INVALID_PARAMS", exitCode: 4 }];
    await writeFile(path.join(root, "protocol", file), `${JSON.stringify({ schemaVersion: 1, [key]: entries }, null, 2)}\n`);
  }
  const families = HANDLER_FAMILIES.map((family) => ({ ...family, unsupportedActions: {} }));
  for (const family of families) {
    await mkdir(path.join(root, family.directory), { recursive: true });
    await writeFile(path.join(root, family.directory, "Handler.java"),
      family.name === "legacy"
        ? 'if ("chat.send".equals(action)) {} if ("status.all".equals(action)) {}'
        : 'switch (action) { case "chat.send", "status.all" -> handle(); }');
  }
  return { root, families };
}

test("extracts switch cases and both equals spellings across lines", () => {
  const actions = extractHandlerActions(`
    switch (action) {
      case "input.key-down", /* same group */
        "input.key-up" -> handle();
      case "chat.send": break;
    }
    if (action.equals("client.respawn")) {}
    if ("status.all".equals(action)) {}
    if (action . equals ( "chat.last" )) {}
    if ("chat.history" . equals ( action )) {}
  `);
  assert.deepEqual([...actions].sort(), [
    "chat.history", "chat.last", "chat.send", "client.respawn",
    "input.key-down", "input.key-up", "status.all",
  ]);
});

test("ignores commented dispatch names and unrelated string literals", () => {
  const actions = extractHandlerActions(String.raw`
    // case "fake.comment" -> ignored();
    /* if ("fake.block".equals(action)) {} */
    String documentation = "action.equals(\"fake.string\")";
    String arbitrary = "fake.name";
    String url = "https://example.test/* not a comment */";
    if ("chat.send".equals(action)) {}
  `);
  assert.deepEqual([...actions], ["chat.send"]);
});

test("reports both missing implementations and undocumented new handlers", () => {
  const result = compareHandlerContract(new Set(["chat.send"]), new Set(["chat.extra"]), {});
  assert.equal(result.success, false);
  assert.deepEqual(result.missingInJava, ["chat.send"]);
  assert.deepEqual(result.missingInProtocol, ["chat.extra"]);
});

test("allows an explicit capability difference only for the selected family", async (t) => {
  const { root, families } = await fixture(t);
  await syncPackagedProtocol(root);
  const legacy = families.find((family) => family.name === "legacy");
  await writeFile(path.join(root, legacy.directory, "Handler.java"), 'if ("chat.send".equals(action)) {}');
  let report = await checkProtocolSync(root, families);
  assert.equal(report.success, false);
  assert.deepEqual(report.handlers.find((handler) => handler.family === "legacy").missingInJava, ["status.all"]);
  assert.equal(report.handlers.find((handler) => handler.family === "yarn").success, true);
  legacy.unsupportedActions["status.all"] = "Fixture models a query absent from the older API.";
  report = await checkProtocolSync(root, families);
  assert.equal(report.success, true);
});

test("rejects unknown, obsolete and unexplained capability exceptions", () => {
  const result = compareHandlerContract(new Set(["chat.send", "status.all"]), new Set(["chat.send"]), {
    "chat.send": "Already implemented",
    "chat.unknown": "Not in the protocol",
    "status.all": " ",
  });
  assert.equal(result.success, false);
  assert.deepEqual(result.obsoleteExemptions, ["chat.send"]);
  assert.deepEqual(result.unknownExemptions, ["chat.unknown"]);
  assert.deepEqual(result.unexplainedExemptions, ["status.all"]);
});

test("sync creates exact package copies and is idempotent", async (t) => {
  const { root, families } = await fixture(t);
  const before = await checkProtocolSync(root, families);
  assert.equal(before.success, false);
  assert.ok(before.packagedFiles.every((file) => file.status === "missing"));
  const first = await syncPackagedProtocol(root);
  assert.deepEqual(first.updatedFiles, PROTOCOL_FILES.map((file) => `cli/data/protocol/${file}`));
  for (const file of PROTOCOL_FILES) {
    assert.equal(await readFile(path.join(root, "cli/data/protocol", file), "utf8"),
      await readFile(path.join(root, "protocol", file), "utf8"));
  }
  assert.equal((await checkProtocolSync(root, families)).success, true);
  assert.deepEqual((await syncPackagedProtocol(root)).updatedFiles, []);
});

test("read-only check detects stale params, descriptions and errors without hiding drift", async (t) => {
  const { root, families } = await fixture(t);
  await syncPackagedProtocol(root);
  for (const file of PROTOCOL_FILES) {
    const destination = path.join(root, "cli/data/protocol", file);
    const stale = '{"schemaVersion":1,"stale":true}\n';
    await writeFile(destination, stale);
    const report = await checkProtocolSync(root, families);
    assert.equal(report.success, false);
    assert.equal(report.packagedFiles.find((entry) => entry.packaged.endsWith(file)).status, "stale");
    assert.equal(await readFile(destination, "utf8"), stale);
    await syncPackagedProtocol(root);
  }
});

test("new canonical actions fail every family until implemented or explained", async (t) => {
  const { root, families } = await fixture(t);
  const actionsFile = path.join(root, "protocol/actions.json");
  const actions = JSON.parse(await readFile(actionsFile, "utf8"));
  actions.actions.push({ name: "chat.new-action", params: [] });
  await writeFile(actionsFile, JSON.stringify(actions));
  await syncPackagedProtocol(root);
  const report = await checkProtocolSync(root, families);
  assert.equal(report.success, false);
  for (const family of report.handlers) assert.deepEqual(family.missingInJava, ["chat.new-action"]);
});

test("an official-only new handler cannot escape the guard", async (t) => {
  const { root, families } = await fixture(t);
  await syncPackagedProtocol(root);
  const official = families.find((family) => family.name === "official");
  await writeFile(path.join(root, official.directory, "Added.java"), 'case "chat.new-action" -> handle();');
  const report = await checkProtocolSync(root, families);
  assert.equal(report.success, false);
  assert.deepEqual(report.handlers.find((family) => family.family === "official").missingInProtocol, ["chat.new-action"]);
});

test("missing handler source directory fails instead of claiming compatibility", async (t) => {
  const { root, families } = await fixture(t);
  await syncPackagedProtocol(root);
  await rm(path.join(root, families[0].directory), { recursive: true });
  await assert.rejects(checkProtocolSync(root, families), { code: "ENOENT" });
});

test("invalid canonical input never replaces the packaged copies", async (t) => {
  const { root } = await fixture(t);
  await syncPackagedProtocol(root);
  const destination = path.join(root, "cli/data/protocol/errors.json");
  const before = await readFile(destination, "utf8");
  await writeFile(path.join(root, "protocol/errors.json"), '{"schemaVersion":1,"errors":[{"code":"REPEATED"},{"code":"REPEATED"}]}');
  await assert.rejects(syncPackagedProtocol(root), /duplicate code: REPEATED/);
  assert.equal(await readFile(destination, "utf8"), before);
});

test("repository package copies and all three handler families are aligned", async () => {
  const report = await checkProtocolSync(ROOT);
  assert.equal(report.success, true, JSON.stringify(report, null, 2));
  assert.deepEqual(report.handlers.map((family) => family.family), ["yarn", "official", "legacy"]);
  for (const family of report.handlers) assert.ok(family.counts.java > 0);
});
