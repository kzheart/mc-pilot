package com.mct.mixin;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.resourcepack.ResourcePackSupport;
import net.minecraft.network.ClientConnection;
import net.minecraft.client.resource.server.ServerResourcePackManager;
import java.util.UUID;
import net.minecraft.client.resource.server.ServerResourcePackLoader;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ServerResourcePackLoader.class)
public abstract class ResourcePackLoaderMixin {
    @Inject(method = "init", at = @At("HEAD"))
    private void mct$bindConnection(ClientConnection connection, ServerResourcePackManager.AcceptanceStatus acceptanceStatus, CallbackInfo ci) {
        ResourcePackSupport.bindConnection(connection);
        ClientStateTracker.getInstance().resourcePacks().supported();
    }

    @Inject(method = "remove", at = @At("TAIL"))
    private void mct$removePack(UUID id, CallbackInfo ci) {
        ClientStateTracker.getInstance().resourcePacks().remove(id.toString());
    }

    @Inject(method = "removeAll", at = @At("TAIL"))
    private void mct$removeAll(CallbackInfo ci) {
        ClientStateTracker.getInstance().resourcePacks().removeAll();
    }
}
