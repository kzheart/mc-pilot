package com.mct.version.impl;

import com.mct.core.util.ActionException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;
import net.minecraft.client.gl.Framebuffer;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.util.ScreenshotRecorder;

public final class ScreenshotSupport {

    private ScreenshotSupport() {}

    public static NativeImage takeScreenshot(Framebuffer framebuffer) {
        AtomicReference<NativeImage> image = new AtomicReference<>();
        CountDownLatch latch = new CountDownLatch(1);
        ScreenshotRecorder.takeScreenshot(framebuffer, captured -> {
            image.set(captured);
            latch.countDown();
        });
        try {
            latch.await();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ActionException("INTERRUPTED");
        }
        return image.get();
    }
}
