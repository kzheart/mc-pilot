package com.mct.mixin;

import com.mct.core.resourcepack.ResourcePackSupport;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.network.ClientPlayNetworkHandler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

@Mixin(ClientPlayNetworkHandler.class)
public abstract class ResourcePackNetworkHandlerMixin {
    // Intermediary name for vanilla's resource-pack confirmation UI task; Yarn leaves it unnamed.
    @Redirect(method = "method_34013", at = @At(value = "INVOKE",
        target = "Lnet/minecraft/client/MinecraftClient;setScreen(Lnet/minecraft/client/gui/screen/Screen;)V"))
    private void mct$captureResourcePackPrompt(MinecraftClient client, Screen screen) {
        ResourcePackSupport.capturePrompt(screen);
        client.setScreen(screen);
        ResourcePackSupport.applyPromptPolicy(client);
    }
}
