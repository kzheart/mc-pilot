package com.mct.mixin;

import com.mct.core.resourcepack.ResourcePackSupport;
import net.minecraft.client.gui.screen.ConnectScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.client.network.ServerInfo;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

@Mixin(ConnectScreen.class)
public abstract class ConnectScreenMixin {
    // Do not reset the live connection when vanilla ignores a duplicate join.
    @ModifyVariable(method = "connect(Lnet/minecraft/client/gui/screen/Screen;Lnet/minecraft/client/MinecraftClient;Lnet/minecraft/client/network/ServerAddress;Lnet/minecraft/client/network/ServerInfo;Z)V", at = @At(value = "NEW", target = "net/minecraft/client/gui/screen/ConnectScreen"), argsOnly = true)
    private static ServerInfo mct$resourcePackPolicy(ServerInfo info, Screen parent, MinecraftClient client, ServerAddress address, ServerInfo originalInfo, boolean quickPlay) {
        return ResourcePackSupport.prepareConnection(info, address,
            serverAddress -> new ServerInfo("MCT Auto Test", serverAddress, ServerInfo.ServerType.OTHER));
    }
}
