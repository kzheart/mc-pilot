package com.mct.mixin;

import com.mct.version.impl.RecordingSupport;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.Framebuffer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The two-argument presentation entry point runs once after world and GUI/HUD rendering. */
@Mixin(Framebuffer.class)
public abstract class FramebufferRecordingMixin {
    @Inject(method = "draw(II)V", at = @At("HEAD"), require = 1)
    private void mct$recordFinalFrame(int width, int height, CallbackInfo ci) {
        MinecraftClient client = MinecraftClient.getInstance();
        if ((Object) this == client.getFramebuffer()) RecordingSupport.onFrame(client);
    }
}
