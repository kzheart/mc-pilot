package com.mct.mixin;

import com.mct.core.state.ClientStateTracker;
import net.minecraft.client.gui.hud.InGameHud;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(InGameHud.class)
public abstract class InGameHudStateMixin {

    @Shadow
    private Text overlayMessage;

    @Shadow
    private Text title;

    @Shadow
    private Text subtitle;

    @Shadow
    private int titleFadeInTicks;

    @Shadow
    private int titleStayTicks;

    @Shadow
    private int titleFadeOutTicks;

    @Inject(method = "setOverlayMessage", at = @At("TAIL"))
    private void mct$recordActionBar(Text message, boolean tinted, CallbackInfo ci) {
        ClientStateTracker.getInstance().recordActionBar(message);
    }

    @Inject(method = "setTitleTicks", at = @At("TAIL"))
    private void mct$recordTitleTicks(int fadeInTicks, int stayTicks, int fadeOutTicks, CallbackInfo ci) {
        recordTitleState();
    }

    @Inject(method = "setSubtitle", at = @At("TAIL"))
    private void mct$recordSubtitle(Text value, CallbackInfo ci) {
        recordTitleState();
    }

    @Inject(method = "setTitle", at = @At("TAIL"))
    private void mct$recordTitle(Text value, CallbackInfo ci) {
        recordTitleState();
    }

    @Inject(method = "clearTitle", at = @At("TAIL"))
    private void mct$clearTitle(CallbackInfo ci) {
        recordTitleState();
    }

    @Inject(method = "setDefaultTitleFade", at = @At("TAIL"))
    private void mct$recordDefaultTitleFade(CallbackInfo ci) {
        recordTitleState();
    }

    private void recordTitleState() {
        ClientStateTracker.getInstance().recordTitle(title, subtitle, titleFadeInTicks, titleStayTicks, titleFadeOutTicks);
    }
}
