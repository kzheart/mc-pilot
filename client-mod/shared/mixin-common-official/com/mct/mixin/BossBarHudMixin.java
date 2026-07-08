package com.mct.mixin;

import com.mct.core.state.ClientStateTracker;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.client.gui.components.BossHealthOverlay;
import net.minecraft.client.gui.components.LerpingBossEvent;
import net.minecraft.network.protocol.game.ClientboundBossEventPacket;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(BossHealthOverlay.class)
public abstract class BossBarHudMixin {

    @Shadow
    @Final
    private Map<UUID, LerpingBossEvent> events;

    @Inject(method = "update", at = @At("TAIL"))
    private void mct$recordBossBars(ClientboundBossEventPacket packet, CallbackInfo ci) {
        ArrayList<Map<String, Object>> values = new ArrayList<>();
        for (LerpingBossEvent bossBar : events.values()) {
            values.add(
                Map.of(
                    "name", bossBar.getName().getString(),
                    "progress", bossBar.getProgress(),
                    "color", bossBar.getColor().getName(),
                    "style", bossBar.getOverlay().getName()
                )
            );
        }
        ClientStateTracker.getInstance().recordBossBars(values);
    }

    @Inject(method = "reset", at = @At("TAIL"))
    private void mct$clearBossBars(CallbackInfo ci) {
        ClientStateTracker.getInstance().recordBossBars(List.of());
    }
}
