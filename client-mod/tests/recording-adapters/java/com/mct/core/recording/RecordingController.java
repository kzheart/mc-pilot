package com.mct.core.recording;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Deterministic ownership fake; the core itself has separate real-encoder tests. */
public final class RecordingController {
    private static final RecordingController INSTANCE = new RecordingController();
    public static RecordingController getInstance() { return INSTANCE; }
    public static final class Capture {
        public final byte[] bytes = new byte[16];
        public final int width = 2, height = 2, fps = 30;
        public final int generation;
        public final long sessionId;
        public boolean released;
        Capture(int generation) { this.generation = generation; this.sessionId = generation; }
    }
    public boolean active;
    public int generation, acquired, submitted, released, failures;
    public boolean readbackPending;
    public long busyDrops;
    public final List<Long> submittedTimes = new ArrayList<Long>();
    public final List<Capture> captures = new ArrayList<Capture>();
    public void reset() {
        active = false; generation = 0; acquired = submitted = released = failures = 0;
        submittedTimes.clear(); captures.clear();
    }
    public void start() { active = true; generation++; }
    public void updateSource(Path path, int width, int height, int fps) {}
    public boolean isRecording() { return active; }
    public Capture acquireFrame(long now) {
        if (!active) return null;
        Capture frame = new Capture(generation); captures.add(frame); acquired++; return frame;
    }
    public boolean isAccepting(Capture capture) { return active && capture.generation == generation; }
    public void submitFrame(Capture capture, long now) {
        if (capture.released) throw new AssertionError("duplicate ownership transfer");
        capture.released = true; submitted++; submittedTimes.add(now);
    }
    public void releaseFrame(Capture capture) {
        if (capture.released) throw new AssertionError("duplicate release");
        capture.released = true; released++;
    }
    public void signalFailure(String error) { active = false; failures++; }
    public void signalFailure(Capture owner, String error) { if (isAccepting(owner)) signalFailure(error); }
    public boolean allocated;
    public void updateReadbackAllocated(boolean value) { allocated = value; }
    public void updateRendererMetrics(String backend, boolean pending, long drops, double average, double maximum) {
        readbackPending = pending; busyDrops = drops;
    }
}
