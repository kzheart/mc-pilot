package com.mct.mixin;

import com.mct.version.impl.RecordingSupport;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** 26.2 moved presentation to GpuSurface. Capture after the final GUI/HUD render. */
@Mixin(value = GameRenderer.class, remap = false)
public abstract class FramebufferRecordingMixin {
    @Inject(method = "render(Lnet/minecraft/client/DeltaTracker;Z)V",
        at = @At("TAIL"), require = 1, remap = false)
    private void mct$recordFinalFrame(CallbackInfo ci) {
        Minecraft client = Minecraft.getInstance();
        RecordingSupport.onFrame(client, client.gameRenderer.mainRenderTarget());
    }
}
