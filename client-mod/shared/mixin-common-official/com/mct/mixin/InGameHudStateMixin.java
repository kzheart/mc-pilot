package com.mct.mixin;

import com.mct.core.state.ClientStateTracker;
import net.minecraft.client.gui.Hud;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Hud.class)
public abstract class InGameHudStateMixin {

    @Shadow
    private Component overlayMessageString;

    @Shadow
    private Component title;

    @Shadow
    private Component subtitle;

    private int mct$titleFadeInTicks;
    private int mct$titleStayTicks;
    private int mct$titleFadeOutTicks;

    @Inject(method = "setOverlayMessage", at = @At("TAIL"))
    private void mct$recordActionBar(Component message, boolean tinted, CallbackInfo ci) {
        ClientStateTracker.getInstance().recordActionBar(message);
    }

    @Inject(method = "setTimes", at = @At("TAIL"))
    private void mct$recordTitleTicks(int fadeInTicks, int stayTicks, int fadeOutTicks, CallbackInfo ci) {
        mct$titleFadeInTicks = fadeInTicks;
        mct$titleStayTicks = stayTicks;
        mct$titleFadeOutTicks = fadeOutTicks;
        recordTitleState();
    }

    @Inject(method = "setSubtitle", at = @At("TAIL"))
    private void mct$recordSubtitle(Component value, CallbackInfo ci) {
        recordTitleState();
    }

    @Inject(method = "setTitle", at = @At("TAIL"))
    private void mct$recordTitle(Component value, CallbackInfo ci) {
        recordTitleState();
    }

    @Inject(method = "clearTitles", at = @At("TAIL"))
    private void mct$clearTitle(CallbackInfo ci) {
        recordTitleState();
    }

    @Inject(method = "resetTitleTimes", at = @At("TAIL"))
    private void mct$recordDefaultTitleFade(CallbackInfo ci) {
        recordTitleState();
    }

    private void recordTitleState() {
        ClientStateTracker.getInstance().recordTitle(title, subtitle, mct$titleFadeInTicks, mct$titleStayTicks, mct$titleFadeOutTicks);
    }
}
