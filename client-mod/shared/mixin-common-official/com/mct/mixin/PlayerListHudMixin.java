package com.mct.mixin;

import com.mct.core.state.ClientStateTracker;
import net.minecraft.client.gui.components.PlayerTabOverlay;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(PlayerTabOverlay.class)
public abstract class PlayerListHudMixin {

    @Shadow
    private Component footer;

    @Shadow
    private Component header;

    @Inject(method = "setFooter", at = @At("TAIL"))
    private void mct$recordFooter(Component value, CallbackInfo ci) {
        recordTabList();
    }

    @Inject(method = "setHeader", at = @At("TAIL"))
    private void mct$recordHeader(Component value, CallbackInfo ci) {
        recordTabList();
    }

    @Inject(method = "reset", at = @At("TAIL"))
    private void mct$clearTabList(CallbackInfo ci) {
        recordTabList();
    }

    private void recordTabList() {
        ClientStateTracker.getInstance().recordTabList(header, footer);
    }
}
