import assert from "node:assert/strict";
import test from "node:test";

import { detectServerStartupPhase } from "./ServerLogManager.js";

test("velocity done line is ready", () => {
  assert.equal(
    detectServerStartupPhase(["[02:31:56 INFO]: Done (1.52s)!"]),
    "ready",
  );
});

test("bungee listening line is ready", () => {
  assert.equal(
    detectServerStartupPhase(["[INFO] Listening on /0.0.0.0:25577"]),
    "ready",
  );
});

test("paper done line still ready", () => {
  assert.equal(
    detectServerStartupPhase([
      '[Server thread/INFO]: Done (3.20s)! For help, type "help"',
    ]),
    "ready",
  );
});

test("velocity boot line is bootstrapping", () => {
  assert.equal(
    detectServerStartupPhase(["[INFO]: Booting up Velocity 3.4.0..."]),
    "bootstrapping",
  );
});
