package com.mct.mixin;

import com.mct.core.state.ClientStateTracker;
import java.util.List;
import net.minecraft.client.resources.server.ServerPackManager;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ServerPackManager.class)
public abstract class ServerResourcePackManagerMixin {

    @Shadow
    private ServerPackManager.PackPromptStatus packPromptStatus;

    @Shadow
    @Final
    private List<?> packs;

    @Inject(method = "pushPack", at = @At("TAIL"))
    private void mct$recordAddedPack(CallbackInfo ci) {
        recordState();
    }

    @Inject(method = "allowServerPacks", at = @At("TAIL"))
    private void mct$recordAccept(CallbackInfo ci) {
        recordState();
    }

    @Inject(method = "rejectServerPacks", at = @At("TAIL"))
    private void mct$recordDecline(CallbackInfo ci) {
        recordState();
    }

    @Inject(method = "resetPromptStatus", at = @At("TAIL"))
    private void mct$recordReset(CallbackInfo ci) {
        recordState();
    }

    @Inject(method = "popAll", at = @At("TAIL"))
    private void mct$recordRemoveAll(CallbackInfo ci) {
        recordState();
    }

    private void recordState() {
        ClientStateTracker.getInstance().recordResourcePackState(
            packPromptStatus != null ? packPromptStatus.name().toLowerCase(java.util.Locale.ROOT) : "unknown",
            packs != null ? packs.size() : 0
        );
    }
}
