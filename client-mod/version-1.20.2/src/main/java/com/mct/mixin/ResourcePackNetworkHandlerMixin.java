package com.mct.mixin;

import com.mct.core.resourcepack.ResourcePackSupport;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.network.ClientCommonNetworkHandler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Mixin(ClientCommonNetworkHandler.class)
public abstract class ResourcePackNetworkHandlerMixin {
    @Redirect(method = "showPackConfirmationScreen", at = @At(value = "INVOKE",
        target = "Lnet/minecraft/client/MinecraftClient;setScreen(Lnet/minecraft/client/gui/screen/Screen;)V"))
    private void mct$captureResourcePackPrompt(MinecraftClient client, Screen screen) {
        ResourcePackSupport.capturePrompt(screen);
        client.setScreen(screen);
        ResourcePackSupport.applyPromptPolicy(client);
    }
}
