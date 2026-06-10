import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { appendTimelineEntry, RecordingStateStore, TIMELINE_FILE, type ActiveRecording } from "./recording-state.js";

async function withTempMctHome(run: (mctHome: string) => Promise<void>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mct-recording-"));
  const previous = process.env.MCT_HOME;
  process.env.MCT_HOME = tempDir;
  try {
    await run(tempDir);
  } finally {
    if (previous === undefined) {
      delete process.env.MCT_HOME;
    } else {
      process.env.MCT_HOME = previous;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

function buildActiveRecording(clientName: string, dir: string): ActiveRecording {
  return {
    recordingId: "rec-test",
    clientName,
    backend: "macos-sck",
    helperPid: 99999,
    dir,
    outputPath: path.join(dir, "recording.mp4"),
    eventLogPath: path.join(dir, "helper.jsonl"),
    startedAt: 1000,
    fps: 30,
    projectId: null
  };
}

test("appendTimelineEntry is a no-op when nothing is recording", async () => {
  await withTempMctHome(async (mctHome) => {
    await appendTimelineEntry("bot", {
      t: Date.now(),
      action: "chat.send",
      params: { message: "hi" },
      success: true,
      durationMs: 5
    });

    // 既不创建 recordings.json,也不留下任何 timeline 产物
    const stateDir = path.join(mctHome, "state");
    const files = await readdir(stateDir, { recursive: true }).catch(() => []);
    assert.deepEqual(files.filter((name) => String(name).includes("timeline")), []);
    assert.deepEqual(
      files.filter((name) => String(name).includes("recordings.json")),
      []
    );
  });
});

test("appendTimelineEntry appends to the active recording timeline", async () => {
  await withTempMctHome(async (mctHome) => {
    const recordingDir = path.join(mctHome, "projects", "demo", "recordings", "rec-test");
    await mkdir(recordingDir, { recursive: true });

    const store = new RecordingStateStore();
    await store.updateRecordings((state) => {
      state.active["bot"] = buildActiveRecording("bot", recordingDir);
    });

    await appendTimelineEntry("bot", {
      t: 1234,
      action: "move.to",
      params: { x: 1, y: 64, z: 2 },
      success: true,
      durationMs: 42
    });
    await appendTimelineEntry("bot", {
      t: 5678,
      action: "block.break",
      params: { x: 1, y: 64, z: 2 },
      success: false,
      durationMs: 7,
      error: "timeout"
    });

    const lines = (await readFile(path.join(recordingDir, TIMELINE_FILE), "utf8")).trim().split("\n");
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), {
      t: 1234,
      action: "move.to",
      params: { x: 1, y: 64, z: 2 },
      success: true,
      durationMs: 42
    });
    assert.equal(JSON.parse(lines[1]).error, "timeout");
  });
});

test("appendTimelineEntry ignores recordings of other clients", async () => {
  await withTempMctHome(async (mctHome) => {
    const recordingDir = path.join(mctHome, "projects", "demo", "recordings", "rec-test");
    await mkdir(recordingDir, { recursive: true });

    const store = new RecordingStateStore();
    await store.updateRecordings((state) => {
      state.active["other-bot"] = buildActiveRecording("other-bot", recordingDir);
    });

    await appendTimelineEntry("bot", {
      t: 1,
      action: "chat.send",
      params: {},
      success: true,
      durationMs: 1
    });

    const files = await readdir(recordingDir);
    assert.deepEqual(files.filter((name) => name === TIMELINE_FILE), []);
  });
});

test("appendTimelineEntry swallows corrupted state files", async () => {
  await withTempMctHome(async (mctHome) => {
    const stateDir = path.join(mctHome, "state");
    await mkdir(stateDir, { recursive: true });
    await writeFile(path.join(stateDir, "recordings.json"), "{ not json", "utf8");

    // 不抛异常即通过
    await appendTimelineEntry("bot", {
      t: 1,
      action: "chat.send",
      params: {},
      success: true,
      durationMs: 1
    });
  });
});
