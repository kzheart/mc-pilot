package com.mct.version.impl;

import com.mct.core.recording.RecordingController;
import com.mct.mixin.RecordingFpsAccessor;
import com.mct.core.recording.render.PboCapture;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.Framebuffer;

public final class RecordingSupport {
    private static final PboCapture CAPTURE = new PboCapture(new Lwjgl3Readback());
    private RecordingSupport() {}
    public static void onFrame(MinecraftClient client) {
        Framebuffer target = client.getFramebuffer();
        CAPTURE.onFrame(client.runDirectory.toPath(), target == null ? 0 : target.fbo,
            target == null ? 0 : target.textureWidth, target == null ? 0 : target.textureHeight, RecordingFpsAccessor.mct$getCurrentFps());
    }
    public static void shutdown() {
        RecordingController.getInstance().cancel("Minecraft client is shutting down");
        CAPTURE.close();
    }
}
