package com.mct.version.impl;

import com.mct.core.recording.RecordingController;
import com.mct.mixin.RecordingFpsAccessor;
import com.mct.core.recording.render.GpuCapture;
import net.minecraft.client.MinecraftClient;

/** Mapping-only bridge; encoding, lifetime and GPU readback are shared. */
public final class RecordingSupport {
    private static final GpuCapture CAPTURE = new GpuCapture();
    private RecordingSupport() {}
    public static void onFrame(MinecraftClient client) {
        var target = client.getFramebuffer();
        CAPTURE.onFrame(client.runDirectory.toPath(), target == null ? null : target.getColorAttachment(),
            target == null ? 0 : target.textureWidth, target == null ? 0 : target.textureHeight, RecordingFpsAccessor.mct$getCurrentFps());
    }
    public static void shutdown() {
        RecordingController.getInstance().cancel("Minecraft client is shutting down");
        CAPTURE.close();
    }
}
