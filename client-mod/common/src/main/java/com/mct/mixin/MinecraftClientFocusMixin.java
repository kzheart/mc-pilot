package com.mct.mixin;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.GameMenuScreen;
import net.minecraft.client.gui.screen.Screen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(MinecraftClient.class)
public abstract class MinecraftClientFocusMixin {

    @Inject(method = "setScreen", at = @At("HEAD"), cancellable = true)
    private void mct$preventPauseMenuWhileUnfocused(Screen screen, CallbackInfo ci) {
        MinecraftClient client = (MinecraftClient) (Object) this;
        if (screen instanceof GameMenuScreen && !client.isWindowFocused()) {
            ci.cancel();
        }
    }
}
