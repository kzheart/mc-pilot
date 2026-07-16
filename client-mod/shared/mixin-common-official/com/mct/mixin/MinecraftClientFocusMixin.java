package com.mct.mixin;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin({Minecraft.class, Gui.class})
public abstract class MinecraftClientFocusMixin {

    @Inject(method = "setScreen", at = @At("HEAD"), cancellable = true, require = 0)
    private void mct$preventPauseMenuWhileUnfocused(Screen screen, CallbackInfo ci) {
        Minecraft client = Minecraft.getInstance();
        if (screen instanceof PauseScreen && !client.isWindowActive()) {
            ci.cancel();
        }
    }
}
