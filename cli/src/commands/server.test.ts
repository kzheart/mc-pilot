import assert from "node:assert/strict";
import test from "node:test";

import { resolveServerJava } from "./server.js";

test("resolveServerJava accepts Java 25 for Minecraft 26.1", async () => {
  const result = await resolveServerJava(
    "vanilla",
    "26.1",
    "/opt/java-25/bin/java",
    async (command) => ({
      available: true,
      command: command ?? "java",
      majorVersion: 25,
    }),
  );

  assert.deepEqual(result, {
    javaCommand: "/opt/java-25/bin/java",
    javaVersion: 25,
  });
});

test("resolveServerJava rejects Java 21 for Minecraft 26.1", async () => {
  await assert.rejects(
    resolveServerJava("vanilla", "26.1", "java", async (command) => ({
      available: true,
      command: command ?? "java",
      majorVersion: 21,
    })),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "JAVA_VERSION_TOO_LOW",
  );
});

test("resolveServerJava reports an unavailable Java command", async () => {
  await assert.rejects(
    resolveServerJava("vanilla", "26.1", "/missing/java", async (command) => ({
      available: false,
      command: command ?? "java",
    })),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "JAVA_NOT_FOUND",
  );
});

test("resolveServerJava rejects unsupported exact server artifacts", async () => {
  await assert.rejects(
    resolveServerJava("paper", "26.1", "java", async (command) => ({
      available: true,
      command: command ?? "java",
      majorVersion: 25,
    })),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "UNSUPPORTED_VERSION",
  );
});

test("resolveServerJava accepts Java 25 for a verified Paper 26.1.2 server", async () => {
  const result = await resolveServerJava(
    "paper",
    "26.1.2",
    "/opt/java-25/bin/java",
    async (command) => ({
      available: true,
      command: command ?? "java",
      majorVersion: 25,
    }),
  );

  assert.equal(result.javaVersion, 25);
});
