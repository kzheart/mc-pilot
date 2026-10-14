package com.mct.core.recording.render;

import com.mct.core.recording.RecordingController;
import com.mct.core.recording.RecordingController.Capture;
import java.nio.file.Path;

/** Two bounded asynchronous transfers. All driver calls stay on the render thread. */
public final class PboCapture {
    public interface Driver {
        int create(int bytes);
        Object enqueue(int buffer, int framebuffer, int width, int height);
        boolean ready(Object fence);
        void copy(int buffer, byte[] bytes, int width, int height);
        void deleteFence(Object fence);
        void deleteBuffer(int buffer);
    }
    private static final long READBACK_TIMEOUT_NANOS = 5_000_000_000L;
    private final RecordingController controller = RecordingController.getInstance();
    private final Driver driver;
    private final Slot[] slots = { new Slot(), new Slot() };
    private long busyDrops, copies, copyNanos, maxCopyNanos, sessionId;
    private int allocatedBytes;
    private static final class Slot {
        int buffer;
        Object fence;
        Capture capture;
        long capturedAt;
    }
    public PboCapture(Driver driver) { this.driver = driver; }

    public void onFrame(Path directory, int framebuffer, int width, int height, int fps) {
        controller.updateSource(directory, width, height, fps);
        Capture attempted = null;
        try {
            long now = System.nanoTime();
            // Drain oldest first even when both fences become ready in the same frame.
            Slot first = slots[0], second = slots[1];
            if (second.capture != null && (first.capture == null || second.capturedAt < first.capturedAt)) {
                first = slots[1]; second = slots[0];
            }
            for (int index = 0; index < slots.length; index++) {
                Slot slot = index == 0 ? first : second;
                if (slot.capture == null) continue;
                attempted = slot.capture;
                if (!controller.isAccepting(slot.capture)) { clear(slot); continue; }
                if (!driver.ready(slot.fence)) {
                    if (now - slot.capturedAt > READBACK_TIMEOUT_NANOS)
                        throw new IllegalStateException("GPU readback timed out");
                    continue;
                }
                Capture capture = slot.capture;
                long started = System.nanoTime();
                driver.copy(slot.buffer, capture.bytes, capture.width, capture.height);
                long elapsed = System.nanoTime() - started;
                copies++; copyNanos += elapsed; maxCopyNanos = Math.max(maxCopyNanos, elapsed);
                driver.deleteFence(slot.fence);
                slot.fence = null; slot.capture = null;
                controller.submitFrame(capture, slot.capturedAt);
            }
            if (!controller.isRecording()) { close(); return; }
            Capture capture = controller.acquireFrame(now);
            if (capture == null) return;
            if (sessionId != capture.sessionId) {
                sessionId = capture.sessionId;
                busyDrops = copies = copyNanos = maxCopyNanos = 0;
            }
            Slot free = null;
            for (Slot slot : slots) if (slot.capture == null) { free = slot; break; }
            if (free == null) { busyDrops++; controller.releaseFrame(capture); return; }
            attempted = capture;
            free.capture = capture; free.capturedAt = now;
            if (allocatedBytes != capture.bytes.length) {
                for (Slot slot : slots) if (slot.buffer != 0) {
                    driver.deleteBuffer(slot.buffer); slot.buffer = 0;
                }
                allocatedBytes = capture.bytes.length;
            }
            if (free.buffer == 0) free.buffer = driver.create(capture.bytes.length);
            free.fence = driver.enqueue(free.buffer, framebuffer, capture.width, capture.height);
        } catch (Throwable failure) {
            if (attempted != null) controller.signalFailure(attempted, "Framebuffer readback failed: " + failure);
            else controller.signalFailure("Framebuffer readback failed: " + failure);
            close();
        } finally {
            boolean pending = false;
            for (Slot slot : slots) pending |= slot.capture != null;
            controller.updateReadbackAllocated(slots[0].buffer != 0 || slots[1].buffer != 0);
            controller.updateRendererMetrics("minecraft-final-framebuffer-pbo", pending, busyDrops,
                copies == 0 ? 0.0 : copyNanos / (double) copies / 1_000_000.0,
                maxCopyNanos / 1_000_000.0);
        }
    }
    private void clear(Slot slot) {
        Object fence = slot.fence; slot.fence = null;
        Capture capture = slot.capture; slot.capture = null;
        try { if (fence != null) driver.deleteFence(fence); }
        finally { if (capture != null) controller.releaseFrame(capture); }
    }
    /** GL deletion releases ownership without waiting for GPU completion. */
    public void close() {
        for (Slot slot : slots) {
            try { clear(slot); } catch (Throwable ignored) { /* A lost GL context must not break shutdown. */ }
            int buffer = slot.buffer; slot.buffer = 0;
            try { if (buffer != 0) driver.deleteBuffer(buffer); }
            catch (Throwable ignored) { /* The context owns any remaining native allocation. */ }
        }
        allocatedBytes = 0;
        controller.updateReadbackAllocated(false);
        controller.updateRendererMetrics("minecraft-final-framebuffer-pbo", false, busyDrops,
            copies == 0 ? 0.0 : copyNanos / (double) copies / 1_000_000.0, maxCopyNanos / 1_000_000.0);
    }
}
