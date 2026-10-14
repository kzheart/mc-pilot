package com.mct.core.recording;

/** Integer-only CFR clock. Capture gaps repeat images; they never shorten the movie. */
final class FrameTimeline {
    static final long SECOND = 1000000000L;
    private FrameTimeline() { }
    static long slot(long elapsed, int fps) {
        elapsed = Math.max(0, elapsed);
        return (elapsed / SECOND) * fps + ((elapsed % SECOND) * fps) / SECOND;
    }
    static long count(long elapsed, int fps) {
        elapsed = Math.max(0, elapsed);
        long whole = slot(elapsed, fps);
        return Math.max(1, whole + (((elapsed % SECOND) * fps) % SECOND == 0 ? 0 : 1));
    }
    static long deadline(long start, long index, int fps) {
        return start + ((index + 1) / fps) * SECOND + (((index + 1) % fps) * SECOND) / fps;
    }
}
