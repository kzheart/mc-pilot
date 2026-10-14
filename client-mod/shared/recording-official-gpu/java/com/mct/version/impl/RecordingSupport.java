package com.mct.version.impl;

import com.mct.core.recording.RecordingController;
import com.mct.core.recording.render.GpuCapture;
import net.minecraft.client.Minecraft;
import com.mojang.blaze3d.pipeline.RenderTarget;

/** Mapping-only bridge; encoding, lifetime and GPU readback are shared. */
public final class RecordingSupport {
    private static final GpuCapture CAPTURE = new GpuCapture();
    private RecordingSupport() {}
    public static void onFrame(Minecraft client, RenderTarget target) {
        CAPTURE.onFrame(client.gameDirectory.toPath(), target == null ? null : target.getColorTexture(),
            target == null ? 0 : target.width, target == null ? 0 : target.height, client.getFps());
    }
    public static void shutdown() {
        RecordingController.getInstance().cancel("Minecraft client is shutting down");
        CAPTURE.close();
    }
}
