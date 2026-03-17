package com.mct.mixin;

import com.mct.core.state.ClientStateTracker;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.client.gui.hud.BossBarHud;
import net.minecraft.client.gui.hud.ClientBossBar;
import net.minecraft.network.packet.s2c.play.BossBarS2CPacket;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(BossBarHud.class)
public abstract class BossBarHudMixin {

    @Shadow
    @Final
    private Map<UUID, ClientBossBar> bossBars;

    @Inject(method = "handlePacket", at = @At("TAIL"))
    private void mct$recordBossBars(BossBarS2CPacket packet, CallbackInfo ci) {
        ArrayList<Map<String, Object>> values = new ArrayList<>();
        for (ClientBossBar bossBar : bossBars.values()) {
            values.add(
                Map.of(
                    "name", bossBar.getName().getString(),
                    "progress", bossBar.getPercent(),
                    "color", bossBar.getColor().getName(),
                    "style", bossBar.getStyle().getName()
                )
            );
        }
        ClientStateTracker.getInstance().recordBossBars(values);
    }

    @Inject(method = "clear", at = @At("TAIL"))
    private void mct$clearBossBars(CallbackInfo ci) {
        ClientStateTracker.getInstance().recordBossBars(List.of());
    }
}
