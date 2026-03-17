package com.mct.mixin;

import com.mct.core.state.ClientStateTracker;
import net.minecraft.client.gui.hud.PlayerListHud;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(PlayerListHud.class)
public abstract class PlayerListHudMixin {

    @Shadow
    private Text footer;

    @Shadow
    private Text header;

    @Inject(method = "setFooter", at = @At("TAIL"))
    private void mct$recordFooter(Text value, CallbackInfo ci) {
        recordTabList();
    }

    @Inject(method = "setHeader", at = @At("TAIL"))
    private void mct$recordHeader(Text value, CallbackInfo ci) {
        recordTabList();
    }

    @Inject(method = "clear", at = @At("TAIL"))
    private void mct$clearTabList(CallbackInfo ci) {
        recordTabList();
    }

    private void recordTabList() {
        ClientStateTracker.getInstance().recordTabList(header, footer);
    }
}
