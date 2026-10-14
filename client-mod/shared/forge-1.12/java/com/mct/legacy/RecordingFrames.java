package com.mct.legacy;

import com.mct.core.recording.render.PboCapture;
import net.minecraft.client.Minecraft;
import net.minecraft.client.shader.Framebuffer;

/** Presentation hook runs after world, GUI/HUD, toasts and the optional F3 profiler chart. */
public final class RecordingFrames {
    private static final PboCapture CAPTURE = new PboCapture(new LegacyReadback());
    private RecordingFrames() {}

    /** Object descriptor keeps the version-local transform independent of Minecraft class remapping. */
    public static void onPresent(Object presented) {
        Minecraft client = Minecraft.getMinecraft();
        if (client == null || presented != client.getFramebuffer()) return;
        Framebuffer target = (Framebuffer) presented;
        CAPTURE.onFrame(client.gameDir.toPath(), target.framebufferObject,
            target.framebufferWidth, target.framebufferHeight, Minecraft.getDebugFPS());
    }
}
