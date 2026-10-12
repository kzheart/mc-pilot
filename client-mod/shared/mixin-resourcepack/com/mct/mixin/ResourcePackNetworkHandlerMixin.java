package com.mct.mixin;

import com.mct.core.resourcepack.ResourcePackSupport;
import com.mct.core.state.ClientStateTracker;
import java.net.URL;
import java.util.UUID;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientCommonNetworkHandler;
import net.minecraft.network.packet.s2c.common.ResourcePackSendS2CPacket;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Final;
import net.minecraft.network.ClientConnection;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(ClientCommonNetworkHandler.class)
public abstract class ResourcePackNetworkHandlerMixin {
    @Shadow @Final protected ClientConnection connection;
    @Shadow @Final protected MinecraftClient client;

    @Inject(method = "createConfirmServerResourcePackScreen", at = @At("RETURN"))
    private void mct$capturePrompt(UUID id, URL url, String hash, boolean required, Text prompt,
            CallbackInfoReturnable<Screen> cir) {
        if (!ResourcePackSupport.isActiveConnection(connection)) return;
        ResourcePackSupport.capturePrompt(cir.getReturnValue());
    }

    @Inject(method = "onResourcePackSend", at = @At(value = "INVOKE",
        target = "Lnet/minecraft/client/network/ClientCommonNetworkHandler;getParsedResourcePackUrl(Ljava/lang/String;)Ljava/net/URL;"))
    private void mct$recordOffer(ResourcePackSendS2CPacket packet, CallbackInfo ci) {
        if (!ResourcePackSupport.isActiveConnection(connection)) return;
        ClientStateTracker.getInstance().resourcePacks().offered(packet.id().toString(), packet.required());
    }

    @Inject(method = "onResourcePackSend", at = @At("TAIL"))
    private void mct$applyPromptPolicy(ResourcePackSendS2CPacket packet, CallbackInfo ci) {
        if (ResourcePackSupport.isActiveConnection(connection)) ResourcePackSupport.applyPromptPolicy(client);
    }
}
