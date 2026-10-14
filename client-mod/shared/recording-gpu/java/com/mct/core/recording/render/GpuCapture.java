package com.mct.core.recording.render;

import com.mct.core.recording.RecordingController;
import com.mct.core.recording.RecordingController.Capture;
import com.mojang.blaze3d.buffers.GpuBuffer;
import com.mojang.blaze3d.systems.CommandEncoder;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.textures.GpuTexture;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicReference;

/** Minecraft's fenced GPU transfer API; one reusable readback, no immediate map/stall. */
public final class GpuCapture {
    private final RecordingController controller = RecordingController.getInstance();
    private GpuBuffer buffer;
    private int allocatedBytes;
    private Pending pending;
    private long busyDrops, copies, copyNanos, maxCopyNanos, sessionId;
    private static final class Pending {
        final AtomicReference<Capture> capture;
        final long capturedAt;
        boolean enqueued;
        Pending(Capture capture, long now) {
            this.capture = new AtomicReference<Capture>(capture); this.capturedAt = now;
        }
    }
    public void onFrame(Path directory, GpuTexture texture, int width, int height, int fps) {
        controller.updateSource(directory, width, height, fps);
        Capture attempted = pending == null ? null : pending.capture.get();
        try {
            if (pending != null && !controller.isAccepting(pending.capture.get())) close();
            if (!controller.isRecording()) { close(); return; }
            long now = System.nanoTime();
            if (pending != null && now - pending.capturedAt > 5_000_000_000L)
                throw new IllegalStateException("GPU readback timed out");
            Capture capture = controller.acquireFrame(now);
            if (capture == null) return;
            if (sessionId != capture.sessionId) {
                sessionId = capture.sessionId;
                busyDrops = copies = copyNanos = maxCopyNanos = 0;
            }
            if (pending != null) { busyDrops++; controller.releaseFrame(capture); return; }
            attempted = capture;
            Pending request = new Pending(capture, now);
            pending = request;
            if (texture == null) throw new IllegalStateException("Main framebuffer has no color attachment");
            if (buffer == null || allocatedBytes != capture.bytes.length) {
                if (buffer != null) buffer.close();
                buffer = RenderSystem.getDevice().createBuffer(() -> "MCT recording readback",
                    GpuBuffer.USAGE_MAP_READ | GpuBuffer.USAGE_COPY_DST, capture.bytes.length);
                allocatedBytes = capture.bytes.length;
            }
            GpuBuffer target = buffer;
            CommandEncoder encoder = RenderSystem.getDevice().createCommandEncoder();
            encoder.copyTextureToBuffer(texture, target, 0L,
                () -> complete(request, encoder, target), 0);
            request.enqueued = true;
        } catch (Throwable failure) {
            if (attempted != null) controller.signalFailure(attempted, "GPU readback failed: " + failure);
            else controller.signalFailure("GPU readback failed: " + failure);
            close();
        } finally { publishMetrics(); }
    }
    private void complete(Pending request, CommandEncoder encoder, GpuBuffer target) {
        Capture capture = request.capture.getAndSet(null);
        if (capture == null) {
            if (pending == request) pending = null;
            publishMetrics();
            return;
        }
        boolean transferred = false;
        try {
            if (!controller.isAccepting(capture)) return;
            long started = System.nanoTime();
            GpuReadback.copy(encoder, target, capture);
            long elapsed = System.nanoTime() - started;
            copies++; copyNanos += elapsed; maxCopyNanos = Math.max(maxCopyNanos, elapsed);
            transferred = true;
            controller.submitFrame(capture, request.capturedAt);
        } catch (Throwable failure) {
            controller.signalFailure(capture, "GPU frame copy failed: " + failure);
        } finally {
            if (!transferred) controller.releaseFrame(capture);
            if (pending == request) pending = null;
            if (!controller.isRecording()) close();
            publishMetrics();
        }
    }
    public void close() {
        Pending request = pending;
        if (request != null) {
            Capture capture = request.capture.getAndSet(null);
            if (capture != null) controller.releaseFrame(capture);
            // Minecraft owns an enqueued callback until its fence drains. Keep one tiny
            // tombstone, without image/session references, and issue no newer transfer.
            // A permanently stalled GPU therefore cannot accumulate canceled callbacks.
            if (!request.enqueued) pending = null;
        }
        GpuBuffer allocated = buffer; buffer = null;
        try { if (allocated != null) allocated.close(); }
        catch (Throwable ignored) { /* A lost GPU context must not prevent session cleanup. */ }
        allocatedBytes = 0;
        publishMetrics();
    }
    private void publishMetrics() {
        controller.updateReadbackAllocated(buffer != null);
        controller.updateRendererMetrics("minecraft-final-framebuffer-gpu-readback", pending != null,
            busyDrops, copies == 0 ? 0.0 : copyNanos / (double) copies / 1_000_000.0,
            maxCopyNanos / 1_000_000.0);
    }
}
