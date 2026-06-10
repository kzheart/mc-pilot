package com.mct.version;

import java.util.concurrent.CompletableFuture;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.texture.NativeImage;

public interface ScreenshotAdapter {
    CompletableFuture<NativeImage> capture(MinecraftClient client);
}
