package com.mct.mixin;

import com.mct.version.impl.RecordingSupport;
import net.minecraft.client.MinecraftClient;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MinecraftClient.class)
public abstract class RecordingShutdownMixin {
    @Inject(method = "close", at = @At("HEAD"), require = 1)
    private void mct$closeRecording(CallbackInfo ci) { RecordingSupport.shutdown(); }
}
