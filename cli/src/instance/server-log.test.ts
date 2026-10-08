import assert from "node:assert/strict";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectOutput, readLinesFrom, waitForLine } from "./server-log.js";

async function tempLog(content = "") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mct-log-"));
  const file = path.join(dir, "latest.log");
  await writeFile(file, content);
  return file;
}

test("readLinesFrom returns complete lines only and strips ANSI", async () => {
  const file = await tempLog("\u001b[32mone\u001b[0m\ntwo\npart");
  const read = await readLinesFrom(file, 0);

  assert.deepEqual(
    read.lines.map((line) => line.text),
    ["one", "two"],
  );
  assert.equal(read.cursor, Buffer.byteLength("\u001b[32mone\u001b[0m\ntwo\n"));

  await appendFile(file, "ial\n");
  const next = await readLinesFrom(file, read.cursor);
  assert.deepEqual(
    next.lines.map((line) => line.text),
    ["partial"],
  );
});

test("readLinesFrom restarts from 0 when the log was rotated", async () => {
  const file = await tempLog("fresh\n");
  const read = await readLinesFrom(file, 10_000);
  assert.deepEqual(
    read.lines.map((line) => line.text),
    ["fresh"],
  );
});

test("waitForLine matches lines written before the call when given a cursor", async () => {
  const file = await tempLog("boot\n");
  const cursor = Buffer.byteLength("boot\n");
  await appendFile(file, "[INFO]: Steve joined\n[INFO]: other\n");

  const match = await waitForLine(file, /joined/, cursor, 1000);
  assert.equal(match?.line, "[INFO]: Steve joined");
  assert.equal(
    match?.cursor,
    Buffer.byteLength("boot\n[INFO]: Steve joined\n"),
  );

  assert.equal(await waitForLine(file, /joined/, match!.cursor, 300), null);
});

test("collectOutput gathers lines appended after the cursor", async () => {
  const file = await tempLog("old\n");
  const cursor = Buffer.byteLength("old\n");
  setTimeout(() => void appendFile(file, "Health: 20.0f\n"), 150);

  const output = await collectOutput(file, cursor, {
    maxMs: 2000,
    quietMs: 200,
  });
  assert.deepEqual(output, ["Health: 20.0f"]);
});
