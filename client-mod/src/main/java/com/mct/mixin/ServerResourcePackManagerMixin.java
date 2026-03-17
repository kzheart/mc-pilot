//? if >=1.20.3 {
package com.mct.mixin;

import com.mct.core.state.ClientStateTracker;
import java.util.List;
import net.minecraft.client.resource.server.ServerResourcePackManager;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ServerResourcePackManager.class)
public abstract class ServerResourcePackManagerMixin {

    @Shadow
    private ServerResourcePackManager.AcceptanceStatus acceptanceStatus;

    @Shadow
    @Final
    private List<?> packs;

    @Inject(method = "addResourcePack", at = @At("TAIL"))
    private void mct$recordAddedPack(CallbackInfo ci) {
        recordState();
    }

    @Inject(method = "acceptAll", at = @At("TAIL"))
    private void mct$recordAccept(CallbackInfo ci) {
        recordState();
    }

    @Inject(method = "declineAll", at = @At("TAIL"))
    private void mct$recordDecline(CallbackInfo ci) {
        recordState();
    }

    @Inject(method = "resetAcceptanceStatus", at = @At("TAIL"))
    private void mct$recordReset(CallbackInfo ci) {
        recordState();
    }

    @Inject(method = "removeAll", at = @At("TAIL"))
    private void mct$recordRemoveAll(CallbackInfo ci) {
        recordState();
    }

    private void recordState() {
        ClientStateTracker.getInstance().recordResourcePackState(
            acceptanceStatus != null ? acceptanceStatus.name().toLowerCase(java.util.Locale.ROOT) : "unknown",
            packs != null ? packs.size() : 0
        );
    }
}
//?}
