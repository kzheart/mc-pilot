import assert from "node:assert/strict";
import test from "node:test";

import {
  getMinecraftSupport,
  getSupportedMinecraftVersions,
  getVersionMatrix,
  searchClientVersions,
} from "./VersionMatrix.js";

test("getVersionMatrix exposes documented client support entries", () => {
  const matrix = getVersionMatrix();

  assert.equal(matrix.length, 14);
  assert.deepEqual(getSupportedMinecraftVersions(), [
    "26.2",
    "26.1.2",
    "26.1.1",
    "26.1",
    "1.21.11",
    "1.21.4",
    "1.21.1",
    "1.20.4",
    "1.20.3",
    "1.20.2",
    "1.20.1",
    "1.18.2",
    "1.16.5",
    "1.12.2",
  ]);

  const latest = getMinecraftSupport("1.21.11");
  assert.ok(latest);
  assert.equal(latest.clients.fabric.supported, true);
  assert.equal(latest.clients.fabric.loaderVersion, "0.19.2");
  assert.equal(latest.clients.forge.supported, true);
  assert.equal(latest.clients.forge.loaderVersion, "61.1.8");
  assert.equal(latest.clients.neoforge.supported, true);
  assert.equal(latest.clients.neoforge.loaderVersion, "21.11.42");
});

test("Minecraft 26.1 exposes exact client support", () => {
  const support = getMinecraftSupport("26.1");

  assert.ok(support);
  assert.equal(support.javaVersion, "25+");
  assert.deepEqual(
    Object.values(support.clients).map((client) => client.validation),
    ["verified", "verified", "verified"],
  );
  assert.equal(support.clients.fabric.loaderVersion, "0.19.3");
  assert.equal(support.clients.forge.loaderVersion, "62.0.9");
  assert.equal(support.clients.neoforge.loaderVersion, "26.1.0.19-beta");
});

test("Minecraft 26.1 patch versions have no client of their own", () => {
  for (const version of ["26.1.1", "26.1.2"]) {
    const support = getMinecraftSupport(version);
    assert.ok(support);
    assert.equal(support.clients.fabric.supported, false);
  }
});

test("searchClientVersions exposes all loaders and java requirements", () => {
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

  assert.equal(forge?.supported, true);
  assert.equal(forge?.loaderVersion, "54.1.16");
  assert.equal(forge?.modVersion, "0.9.1");
  assert.equal(forge?.validation, "verified");
  assert.equal(forge?.javaVersion, "21+");

  assert.equal(neoforge?.supported, true);
  assert.equal(neoforge?.loaderVersion, "21.4.157");
  assert.equal(neoforge?.modVersion, "0.9.1");
  assert.equal(neoforge?.validation, "verified");
  assert.equal(neoforge?.javaVersion, "21+");
});

test("searchClientVersions exposes newly supported 1.20.x fabric variants", () => {
  const results = searchClientVersions({ loader: "fabric" }).filter(
    (entry) =>
      entry.minecraftVersion === "1.20.3" ||
      entry.minecraftVersion === "1.20.2",
  );

  assert.deepEqual(results, [
    {
      loader: "fabric",
      minecraftVersion: "1.20.3",
      supported: true,
      loaderVersion: "0.16.14",
      modVersion: "0.9.1",
      validation: "verified",
      javaVersion: "17+",
    },
    {
      loader: "fabric",
      minecraftVersion: "1.20.2",
      supported: true,
      loaderVersion: "0.16.14",
      modVersion: "0.9.1",
      validation: "verified",
      javaVersion: "17+",
    },
  ]);
});

test("searchClientVersions exposes configured 1.20.x Forge variants", () => {
  const results = searchClientVersions({ loader: "forge" }).filter(
    (entry) =>
      entry.minecraftVersion === "1.20.4" ||
      entry.minecraftVersion === "1.20.2" ||
      entry.minecraftVersion === "1.20.1",
  );

  assert.deepEqual(results, [
    {
      loader: "forge",
      minecraftVersion: "1.20.4",
      supported: true,
      loaderVersion: "49.0.49",
      modVersion: "0.9.1",
      validation: "verified",
      javaVersion: "17+",
    },
    {
      loader: "forge",
      minecraftVersion: "1.20.2",
      supported: true,
      loaderVersion: "48.1.0",
      modVersion: "0.9.1",
      validation: "verified",
      javaVersion: "17+",
    },
    {
      loader: "forge",
      minecraftVersion: "1.20.1",
      supported: true,
      loaderVersion: "47.3.0",
      modVersion: "0.9.1",
      validation: "verified",
      javaVersion: "17+",
    },
  ]);
});

test("Minecraft 1.12.2 exposes selectable Forge builds from the real variant", () => {
  const [forge] = searchClientVersions({
    loader: "forge",
    version: "1.12.2",
  });

  assert.equal(forge?.supported, true);
  assert.equal(forge?.loaderVersion, "14.23.5.2864");
  assert.deepEqual(forge?.loaderVersions, [
    "14.23.5.2859",
    "14.23.5.2860",
    "14.23.5.2864",
  ]);
  assert.equal(forge?.javaVersion, "8");
  assert.equal(forge?.validation, "verified");
});
