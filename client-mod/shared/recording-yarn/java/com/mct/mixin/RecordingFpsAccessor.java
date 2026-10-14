package com.mct.mixin;

import net.minecraft.client.MinecraftClient;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** The oldest supported Yarn clients have no public FPS getter. */
@Mixin(MinecraftClient.class)
public interface RecordingFpsAccessor {
    @Accessor("currentFps")
    static int mct$getCurrentFps() { throw new AssertionError("Mixin accessor was not applied"); }
}
