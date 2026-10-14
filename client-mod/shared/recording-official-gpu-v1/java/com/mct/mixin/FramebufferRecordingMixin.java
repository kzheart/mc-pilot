package com.mct.mixin;

import com.mct.version.impl.RecordingSupport;
import net.minecraft.client.Minecraft;
import com.mojang.blaze3d.pipeline.RenderTarget;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Main color target is complete (world and GUI/HUD), immediately before presentation. */
@Mixin(value = RenderTarget.class, remap = false)
public abstract class FramebufferRecordingMixin {
    @Inject(method = "blitToScreen", at = @At("HEAD"), require = 1, remap = false)
    private void mct$recordFinalFrame(CallbackInfo ci) {
        Minecraft client = Minecraft.getInstance();
        RenderTarget target = client.getMainRenderTarget();
        if ((Object) this == target) RecordingSupport.onFrame(client, target);
    }
}
