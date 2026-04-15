package com.mct.core.state;

import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;

/**
 * 每 tick 采样玩家状态，在状态发生跃迁时写入事件（进水/出水/低氧/受伤/重生等）。
 * 事件写入 {@link EventRecorder}。
 *
 * 通过 Mixin 在 MinecraftClient#tick 的 TAIL 调用 {@link #sample(MinecraftClient)}。
 */
public final class ClientTickSampler {

    private static final ClientTickSampler INSTANCE = new ClientTickSampler();

    private static final int LOW_AIR_THRESHOLD = 60;
    private static final float DAMAGE_EVENT_MIN_DELTA = 0.5f;

    private boolean initialized = false;
    private boolean wasInWater = false;
    private boolean wasLowAir = false;
    private boolean wasDead = false;
    private int lastAir = Integer.MAX_VALUE;
    private float lastHealth = Float.NaN;

    private ClientTickSampler() {
    }

    public static ClientTickSampler getInstance() {
        return INSTANCE;
    }

    public void sample(MinecraftClient client) {
        if (client == null) {
            return;
        }
        ClientPlayerEntity player = client.player;
        if (player == null) {
            // player unavailable: reset so next join starts fresh
            initialized = false;
            return;
        }

        EventRecorder recorder = EventRecorder.getInstance();

        boolean inWater = player.isSubmergedInWater();
        int air = player.getAir();
        int maxAir = player.getMaxAir();
        boolean lowAir = air < LOW_AIR_THRESHOLD && air < maxAir;
        float health = player.getHealth();
        boolean dead = player.isDead() || health <= 0f;

        if (!initialized) {
            wasInWater = inWater;
            wasLowAir = lowAir;
            wasDead = dead;
            lastAir = air;
            lastHealth = health;
            initialized = true;
            return;
        }

        // 进水 / 出水
        if (inWater && !wasInWater) {
            recorder.record("player.entered_water", positionPayload(player));
        } else if (!inWater && wasInWater) {
            recorder.record("player.left_water", positionPayload(player));
        }

        // 低氧 / 恢复氧气
        if (lowAir && !wasLowAir) {
            Map<String, Object> payload = positionPayload(player);
            payload.put("air", air);
            payload.put("maxAir", maxAir);
            recorder.record("player.low_air", payload);
        } else if (!lowAir && wasLowAir) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("air", air);
            payload.put("maxAir", maxAir);
            recorder.record("player.air_recovered", payload);
        }

        // 掉血事件（只记"受伤"，不记"回血"，避免刷屏）
        if (!Float.isNaN(lastHealth) && health + DAMAGE_EVENT_MIN_DELTA < lastHealth) {
            Map<String, Object> payload = positionPayload(player);
            payload.put("health", health);
            payload.put("previousHealth", lastHealth);
            payload.put("delta", lastHealth - health);
            recorder.record("player.damaged", payload);
        }

        // 死亡 / 重生
        if (dead && !wasDead) {
            // DeathScreenMixin 已经记录了 player.died，这里不重复记录
        } else if (!dead && wasDead) {
            Map<String, Object> payload = positionPayload(player);
            payload.put("health", health);
            recorder.record("player.respawned", payload);
        }

        wasInWater = inWater;
        wasLowAir = lowAir;
        wasDead = dead;
        lastAir = air;
        lastHealth = health;
    }

    private static Map<String, Object> positionPayload(ClientPlayerEntity player) {
        LinkedHashMap<String, Object> map = new LinkedHashMap<>();
        map.put("x", player.getX());
        map.put("y", player.getY());
        map.put("z", player.getZ());
        return map;
    }
}
