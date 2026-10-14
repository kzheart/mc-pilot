package com.mct.mixin;

import com.mct.version.impl.RecordingSupport;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(value = Minecraft.class, remap = false)
public abstract class RecordingShutdownMixin {
    @Inject(method = "close", at = @At("HEAD"), require = 1, remap = false)
    private void mct$closeRecording(CallbackInfo ci) { RecordingSupport.shutdown(); }
}
