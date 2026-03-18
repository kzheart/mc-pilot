package com.mct.mixin;

import com.mct.core.state.ClientStateTracker;
import net.minecraft.client.network.ClientPlayNetworkHandler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(value = ClientPlayNetworkHandler.class, priority = 900)
public abstract class ClientPlayNetworkHandlerResourcePackMixin {

    @Inject(method = "onResourcePackSend*", at = @At("HEAD"))
    private void mct$recordResourcePackPending(CallbackInfo ci) {
        ClientStateTracker.getInstance().recordResourcePackState("pending", 1);
    }
}
