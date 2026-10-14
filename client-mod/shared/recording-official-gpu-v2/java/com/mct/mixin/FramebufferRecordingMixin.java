package com.mct.mixin;

import com.mct.version.impl.RecordingSupport;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Capture the presented image, including Forge/NeoForge post-render event draws. */
@Mixin(value = Minecraft.class, remap = false)
public abstract class FramebufferRecordingMixin {
    @Inject(method = "renderFrame(Z)V", at = @At(value = "INVOKE",
        target = "Lcom/mojang/blaze3d/systems/GpuSurface;blitFromTexture(Lcom/mojang/blaze3d/systems/CommandEncoder;Lcom/mojang/blaze3d/textures/GpuTextureView;)V",
        shift = At.Shift.BEFORE, remap = false), require = 1, allow = 1, remap = false)
    private void mct$recordFinalFrame(boolean advanceGameTime, CallbackInfo ci) {
        Minecraft client = (Minecraft) (Object) this;
        RecordingSupport.onFrame(client, client.gameRenderer.mainRenderTarget());
    }
}
