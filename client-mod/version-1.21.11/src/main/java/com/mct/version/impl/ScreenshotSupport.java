package com.mct.version.impl;

import com.mct.core.util.ActionException;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.gl.Framebuffer;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.util.ScreenshotRecorder;

public final class ScreenshotSupport {

    private ScreenshotSupport() {}

    public static CompletableFuture<NativeImage> takeScreenshot(MinecraftClient client) {
        CompletableFuture<NativeImage> future = new CompletableFuture<>();
        Framebuffer framebuffer = client.getFramebuffer();
        ScreenshotRecorder.takeScreenshot(framebuffer, captured -> {
            if (captured == null) {
                future.completeExceptionally(new ActionException("TIMEOUT"));
            } else {
                future.complete(captured);
            }
        });
        return future;
    }
}
