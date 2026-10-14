package com.mct.mixin;

import com.mct.audio.GameAudioExecutorBridge;
import net.minecraft.client.sound.SoundEngine;
import net.minecraft.client.sound.SoundExecutor;
import net.minecraft.client.sound.SoundSystem;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(SoundSystem.class)
public abstract class GameAudioExecutorMixin {
    @Shadow @Final private SoundEngine soundEngine;
    @Shadow @Final private SoundExecutor taskQueue;

    @Inject(method = "<init>", at = @At("RETURN"))
    private void mct$bindMixerExecutor(CallbackInfo ci) {
        ((GameAudioExecutorBridge) soundEngine).mct$setSoundExecutor(taskQueue);
    }
}
