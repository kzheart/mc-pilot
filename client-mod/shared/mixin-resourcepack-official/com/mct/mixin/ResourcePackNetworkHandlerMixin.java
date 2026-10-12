package com.mct.mixin;

import com.mct.core.resourcepack.ResourcePackSupport;
import com.mct.core.state.ClientStateTracker;
import java.net.URL;
import java.util.UUID;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientCommonPacketListenerImpl;
import net.minecraft.network.protocol.common.ClientboundResourcePackPushPacket;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.Final;
import net.minecraft.network.Connection;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(ClientCommonPacketListenerImpl.class)
public abstract class ResourcePackNetworkHandlerMixin {
    @Shadow @Final protected Connection connection;
    @Shadow @Final protected Minecraft minecraft;

    @Inject(method = "addOrUpdatePackPrompt", at = @At("RETURN"))
    private void mct$capturePrompt(UUID id, URL url, String hash, boolean required, Component prompt,
            CallbackInfoReturnable<Screen> cir) {
        if (!ResourcePackSupport.isActiveConnection(connection)) return;
        ResourcePackSupport.capturePrompt(cir.getReturnValue());
    }

    @Inject(method = "handleResourcePackPush", at = @At(value = "INVOKE",
        target = "Lnet/minecraft/client/multiplayer/ClientCommonPacketListenerImpl;parseResourcePackUrl(Ljava/lang/String;)Ljava/net/URL;"))
    private void mct$recordOffer(ClientboundResourcePackPushPacket packet, CallbackInfo ci) {
        if (!ResourcePackSupport.isActiveConnection(connection)) return;
        ClientStateTracker.getInstance().resourcePacks().offered(packet.id().toString(), packet.required());
    }

    @Inject(method = "handleResourcePackPush", at = @At("TAIL"))
    private void mct$applyPromptPolicy(ClientboundResourcePackPushPacket packet, CallbackInfo ci) {
        if (ResourcePackSupport.isActiveConnection(connection)) ResourcePackSupport.applyPromptPolicy(minecraft);
    }
}
