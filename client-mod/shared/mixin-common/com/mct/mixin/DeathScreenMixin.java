package com.mct.mixin;

import com.mct.core.state.ClientStateTracker;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.DeathScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(DeathScreen.class)
public abstract class DeathScreenMixin extends Screen {

    @Shadow
    private int ticksSinceDeath;

    protected DeathScreenMixin(Text title) {
        super(title);
    }

    @Inject(method = "init", at = @At("TAIL"))
    private void mct$onDeathScreenInit(CallbackInfo ci) {
        MinecraftClient client = MinecraftClient.getInstance();
        ClientPlayerEntity player = client.player;
        double x = player != null ? player.getX() : 0;
        double y = player != null ? player.getY() : 0;
        double z = player != null ? player.getZ() : 0;
        String message = this.getTitle() != null ? this.getTitle().getString() : "Unknown";

        ClientStateTracker.getInstance().recordDeath(message, x, y, z);
    }

    @Inject(method = "tick", at = @At("TAIL"))
    private void mct$autoRespawn(CallbackInfo ci) {
        if (this.ticksSinceDeath >= 20) {
            MinecraftClient client = MinecraftClient.getInstance();
            if (client.player != null) {
                client.player.requestRespawn();
                client.setScreen(null);
            }
        }
    }
}
