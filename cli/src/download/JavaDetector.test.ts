import assert from "node:assert/strict";
import test from "node:test";

import { parseJavaMajorVersion } from "./JavaDetector.js";

test("parseJavaMajorVersion parses modern Java version output", () => {
  assert.equal(parseJavaMajorVersion('openjdk version "21.0.2" 2024-01-16'), 21);
});

test("parseJavaMajorVersion parses legacy Java 8 output", () => {
  assert.equal(parseJavaMajorVersion('java version "1.8.0_452"'), 8);
});
