import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { createPruneCommand } from "./prune.js";
import { GlobalStateStore } from "../util/global-state.js";

const DAY_MS = 86_400_000;

async function seedProject(
  home: string,
  projectId: string,
  ageDays: number,
  bytes: number,
) {
  const dir = path.join(home, "projects", projectId);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "world.dat");
  await writeFile(file, Buffer.alloc(bytes));
  await writeFile(path.join(dir, "project.json"), "{}");
  const when = new Date(Date.now() - ageDays * DAY_MS);
  await utimes(file, when, when);
  await utimes(path.join(dir, "project.json"), when, when);
  return dir;
}

async function runPrune(argv: string[]) {
  const command = createPruneCommand().exitOverride();
  const out: string[] = [];
  const err: string[] = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  const originalExitCode = process.exitCode;
  process.stdout.write = ((chunk: string) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    await command.parseAsync(["node", "prune", ...argv]);
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }

  if (out.length === 0) {
    // wrapCommand turns an MctError into a stderr envelope plus an exit code.
    process.exitCode = originalExitCode;
    throw new Error(err.join("").trim() || "prune produced no output");
  }
  return (JSON.parse(out.join("")) as { data: unknown }).data;
}

async function withHome(run: (home: string) => Promise<void>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-prune-"));
  const previousHome = process.env.MCT_HOME;
  const previousCwd = process.cwd();
  const home = path.join(tempDir, "mct-home");
  process.env.MCT_HOME = home;
  await mkdir(path.join(home, "projects"), { recursive: true });
  // Run from outside any project so the cwd-derived keep rule stays out of it.
  process.chdir(tempDir);
  try {
    await run(home);
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previousHome;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("prune reports without deleting unless --yes is given", async () => {
  await withHome(async (home) => {
    const stale = await seedProject(home, "stale-project", 30, 4096);

    const preview = (await runPrune(["--older-than", "7d"])) as {
      dryRun: boolean;
      candidates: Array<{ projectId: string; bytes: number }>;
      reclaimableBytes: number;
    };

    assert.equal(preview.dryRun, true);
    assert.deepEqual(
      preview.candidates.map((c) => c.projectId),
      ["stale-project"],
    );
    assert.ok(preview.reclaimableBytes >= 4096);
    assert.ok(
      await import("node:fs").then((fs) => fs.existsSync(stale)),
      "dry run must not delete anything",
    );
  });
});

test("prune keeps projects that are newer than the cutoff", async () => {
  await withHome(async (home) => {
    await seedProject(home, "fresh-project", 1, 1024);

    const preview = (await runPrune(["--older-than", "7d"])) as {
      candidates: unknown[];
      kept: Array<{ projectId: string; reason: string }>;
    };

    assert.deepEqual(preview.candidates, []);
    assert.equal(preview.kept[0].projectId, "fresh-project");
    assert.match(preview.kept[0].reason, /used within/);
  });
});

test("prune never deletes a project whose server is running", async () => {
  await withHome(async (home) => {
    await seedProject(home, "live-project", 30, 2048);

    const store = new GlobalStateStore();
    await store.writeServerState({
      servers: {
        "live-project/paper": {
          pid: process.pid,
          project: "live-project",
          name: "paper",
          port: 25565,
          startedAt: new Date().toISOString(),
          logPath: path.join(home, "logs", "paper.log"),
          instanceDir: path.join(home, "projects", "live-project", "paper"),
        },
      },
    });

    const result = (await runPrune(["--older-than", "7d", "--yes"])) as {
      deleted: string[];
      kept: Array<{ projectId: string; reason: string }>;
    };

    assert.deepEqual(result.deleted, []);
    assert.equal(result.kept[0].reason, "server running");
    assert.ok(
      await import("node:fs").then((fs) =>
        fs.existsSync(path.join(home, "projects", "live-project")),
      ),
    );
  });
});

test("prune deletes stale projects with --yes and reports what it reclaimed", async () => {
  await withHome(async (home) => {
    await seedProject(home, "stale-project", 30, 8192);
    await seedProject(home, "fresh-project", 1, 1024);

    const result = (await runPrune(["--older-than", "7d", "--yes"])) as {
      dryRun: boolean;
      deleted: string[];
      reclaimedBytes: number;
    };

    assert.equal(result.dryRun, false);
    assert.deepEqual(result.deleted, ["stale-project"]);
    assert.ok(result.reclaimedBytes >= 8192);

    const fs = await import("node:fs");
    assert.equal(
      fs.existsSync(path.join(home, "projects", "stale-project")),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(home, "projects", "fresh-project")),
      true,
    );
  });
});

test("prune honours --keep", async () => {
  await withHome(async (home) => {
    await seedProject(home, "stale-project", 30, 2048);

    const result = (await runPrune([
      "--older-than",
      "7d",
      "--keep",
      "stale-project",
      "--yes",
    ])) as { deleted: string[]; kept: Array<{ reason: string }> };

    assert.deepEqual(result.deleted, []);
    assert.equal(result.kept[0].reason, "explicitly kept");
  });
});

test("prune rejects a malformed --older-than", async () => {
  await withHome(async () => {
    await assert.rejects(
      () => runPrune(["--older-than", "yesterday"]),
      /Invalid --older-than/,
    );
  });
});
