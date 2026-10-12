package com.mct.mixin;

import com.mct.core.resourcepack.ResourcePackSupport;
import net.minecraft.client.gui.screen.ConnectScreen;
import net.minecraft.client.network.ServerInfo;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

@Mixin(ConnectScreen.class)
public abstract class ConnectScreenMixin {
    @ModifyVariable(method = "connect(Lnet/minecraft/client/gui/screen/Screen;Lnet/minecraft/client/MinecraftClient;Lnet/minecraft/client/network/ServerAddress;Lnet/minecraft/client/network/ServerInfo;)V", at = @At("HEAD"), argsOnly = true)
    private static ServerInfo mct$resourcePackPolicy(ServerInfo info) {
        return ResourcePackSupport.prepareConnection(info);
    }
}
