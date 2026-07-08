package com.mct.version;

import com.mojang.blaze3d.platform.NativeImage;
import java.util.concurrent.CompletableFuture;
import net.minecraft.client.Minecraft;

public interface ScreenshotAdapter {
    CompletableFuture<NativeImage> capture(Minecraft client);
}
