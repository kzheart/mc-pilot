package com.mct.version.impl;

import com.mct.core.util.ActionException;
import com.mct.version.ClientVersionModulesHolder;
import com.mojang.blaze3d.pipeline.RenderTarget;
import com.mojang.blaze3d.platform.NativeImage;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;

public final class ScreenshotSupport {

    private ScreenshotSupport() {}

    public static CompletableFuture<NativeImage> takeScreenshot(Minecraft client) {
        CompletableFuture<NativeImage> future = new CompletableFuture<>();
        RenderTarget framebuffer = ClientVersionModulesHolder.get().compatibility().getMainRenderTarget(client);
        Screenshot.takeScreenshot(framebuffer, captured -> {
            if (captured == null) {
                future.completeExceptionally(new ActionException("TIMEOUT"));
            } else {
                future.complete(captured);
            }
        });
        return future;
    }
}
