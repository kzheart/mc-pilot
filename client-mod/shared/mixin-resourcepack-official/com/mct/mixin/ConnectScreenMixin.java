package com.mct.mixin;

import com.mct.core.resourcepack.ResourcePackSupport;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.multiplayer.ServerData;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

@Mixin(ConnectScreen.class)
public abstract class ConnectScreenMixin {
    // Only reset state after vanilla's already-connecting guard has allowed a new join.
    @ModifyVariable(method = "startConnecting(Lnet/minecraft/client/gui/screens/Screen;Lnet/minecraft/client/Minecraft;Lnet/minecraft/client/multiplayer/resolver/ServerAddress;Lnet/minecraft/client/multiplayer/ServerData;ZLnet/minecraft/client/multiplayer/TransferState;)V", at = @At(value = "NEW", target = "net/minecraft/client/gui/screens/ConnectScreen"), argsOnly = true)
    private static ServerData mct$resourcePackPolicy(ServerData info) {
        return ResourcePackSupport.prepareConnection(info);
    }
}
