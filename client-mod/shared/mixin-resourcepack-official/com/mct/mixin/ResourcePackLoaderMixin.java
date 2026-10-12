package com.mct.mixin;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.resourcepack.ResourcePackSupport;
import net.minecraft.network.Connection;
import net.minecraft.client.resources.server.ServerPackManager;
import java.util.UUID;
import net.minecraft.client.resources.server.DownloadedPackSource;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(DownloadedPackSource.class)
public abstract class ResourcePackLoaderMixin {
    @Inject(method = "configureForServerControl", at = @At("HEAD"))
    private void mct$bindConnection(Connection connection, ServerPackManager.PackPromptStatus acceptanceStatus, CallbackInfo ci) {
        ResourcePackSupport.bindConnection(connection);
        ClientStateTracker.getInstance().resourcePacks().supported();
    }

    @Inject(method = "popPack", at = @At("TAIL"))
    private void mct$removePack(UUID id, CallbackInfo ci) {
        ClientStateTracker.getInstance().resourcePacks().remove(id.toString());
    }

    @Inject(method = "popAll", at = @At("TAIL"))
    private void mct$removeAll(CallbackInfo ci) {
        ClientStateTracker.getInstance().resourcePacks().removeAll();
    }
}
