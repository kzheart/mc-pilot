import assert from "node:assert/strict";
import test from "node:test";

import {
  getMinecraftSupport,
  getSupportedMinecraftVersions,
  getVersionMatrix,
  searchClientVersions,
  searchServerVersions
} from "./VersionMatrix.js";

test("getVersionMatrix exposes documented server and client support entries", () => {
  const matrix = getVersionMatrix();

  assert.equal(matrix.length, 9);
  assert.deepEqual(getSupportedMinecraftVersions(), ["1.21.4", "1.21.1", "1.20.4", "1.20.3", "1.20.2", "1.20.1", "1.18.2", "1.16.5", "1.12.2"]);

  const current = getMinecraftSupport("1.20.4");
  assert.ok(current);
  assert.equal(current.servers.paper.latestBuild, 496);
  assert.equal(current.clients.fabric.supported, true);
  assert.equal(current.clients.forge.loaderVersion, "49.0.49");
  assert.equal(current.clients.neoforge.supported, false);
});

test("searchServerVersions can filter by type and version", () => {
  const results = searchServerVersions({ type: "paper", version: "1.20.4" });

  assert.deepEqual(results, [
    {
      type: "paper",
      minecraftVersion: "1.20.4",
      supported: true,
      latestBuild: 496,
      requiresBuildTools: undefined
    }
  ]);
});

test("searchClientVersions preserves unsupported loaders and java requirements", () => {
  const results = searchClientVersions({ version: "1.21.4" });

  assert.equal(results.length, 3);

  const neoforge = results.find((entry) => entry.loader === "neoforge");
  const fabric = results.find((entry) => entry.loader === "fabric");
  const forge = results.find((entry) => entry.loader === "forge");

  assert.equal(fabric?.supported, true);
  assert.equal(fabric?.loaderVersion, "0.16.14");
  assert.equal(fabric?.modVersion, "0.9.1");
  assert.equal(fabric?.validation, "verified");
  assert.equal(fabric?.notes, undefined);
  assert.equal(fabric?.javaVersion, "21+");

  assert.equal(forge?.supported, false);
  assert.equal(forge?.loaderVersion, undefined);
  assert.equal(forge?.modVersion, undefined);
  assert.equal(forge?.notes, "不支持此版本");
  assert.equal(forge?.javaVersion, "21+");

  assert.equal(neoforge?.supported, false);
  assert.equal(neoforge?.loaderVersion, "21.4.75");
  assert.equal(neoforge?.modVersion, "0.9.1");
  assert.equal(neoforge?.validation, "planned");
  assert.equal(neoforge?.javaVersion, "21+");
});

test("searchClientVersions exposes newly supported 1.20.x fabric variants", () => {
  const results = searchClientVersions({ loader: "fabric" }).filter(
    (entry) => entry.minecraftVersion === "1.20.3" || entry.minecraftVersion === "1.20.2"
  );

  assert.deepEqual(results, [
    {
      loader: "fabric",
      minecraftVersion: "1.20.3",
      supported: true,
      loaderVersion: "0.16.14",
      modVersion: "0.9.1",
      validation: "verified",
      javaVersion: "17+"
    },
    {
      loader: "fabric",
      minecraftVersion: "1.20.2",
      supported: true,
      loaderVersion: "0.16.14",
      modVersion: "0.9.1",
      validation: "verified",
      javaVersion: "17+"
    }
  ]);
});
