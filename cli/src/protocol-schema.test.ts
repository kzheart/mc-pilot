import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildProgram } from "./index.js";
import { buildSchemaDocument } from "./schema.js";

test("CLI schema retains every canonical action, query, parameter and error entry", async () => {
  const schema = buildSchemaDocument(buildProgram());
  for (const key of ["actions", "queries", "errors"] as const) {
    const source = JSON.parse(
      await readFile(
        new URL(`../../protocol/${key}.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(schema.protocol[key], source[key]);
  }
});

test("CLI schema preserves canonical transport budget and cancellation contract", async () => {
  const schema = buildSchemaDocument(buildProgram());
  const source = JSON.parse(
    await readFile(
      new URL("../../protocol/actions.json", import.meta.url),
      "utf8",
    ),
  );
  for (const key of ["requestFormat", "responseFormat", "transport"] as const) {
    assert.deepEqual(schema.protocol[key], source[key]);
  }
});
