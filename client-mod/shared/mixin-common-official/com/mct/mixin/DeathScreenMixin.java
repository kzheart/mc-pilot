package com.mct.mixin;

import com.mct.core.state.ClientStateTracker;
import com.mct.version.ClientVersionModulesHolder;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.DeathScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(DeathScreen.class)
public abstract class DeathScreenMixin extends Screen {

    @Shadow
    private int delayTicker;

    protected DeathScreenMixin(Component title) {
        super(title);
    }

    @Inject(method = "init", at = @At("TAIL"))
    private void mct$onDeathScreenInit(CallbackInfo ci) {
        Minecraft client = Minecraft.getInstance();
        LocalPlayer player = client.player;
        double x = player != null ? player.getX() : 0;
        double y = player != null ? player.getY() : 0;
        double z = player != null ? player.getZ() : 0;
        String message = this.getTitle() != null ? this.getTitle().getString() : "Unknown";

        ClientStateTracker.getInstance().recordDeath(message, x, y, z);
    }

    @Inject(method = "tick", at = @At("TAIL"))
    private void mct$autoRespawn(CallbackInfo ci) {
        if (this.delayTicker >= 20) {
            Minecraft client = Minecraft.getInstance();
            if (client.player != null) {
                client.player.respawn();
                ClientVersionModulesHolder.get().compatibility().setScreen(client, null);
            }
        }
    }
}
