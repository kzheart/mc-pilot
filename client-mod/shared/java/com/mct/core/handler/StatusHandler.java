package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.*;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.core.util.ClientDataHelper;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ClientPlayerInteractionManager;
import net.minecraft.world.GameMode;

public final class StatusHandler extends ActionHandler {

    private static final double DEFAULT_WAIT_TIMEOUT_SECONDS = 10.0D;

    public StatusHandler(MinecraftClient client, ClientStateTracker stateTracker) {
        super(client, stateTracker);
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
            case "position.get" -> runOnClientThread(() -> positionMap(requirePlayer()));
            case "rotation.get" -> runOnClientThread(() -> rotationMap(requirePlayer()));
            case "wait.perform" -> performWait(params);
            case "status.health" -> runOnClientThread(this::healthStatus);
            case "status.effects" -> runOnClientThread(this::effectsStatus);
            case "status.experience" -> runOnClientThread(this::experienceStatus);
            case "status.gamemode" -> runOnClientThread(this::gamemodeStatus);
            case "status.world" -> runOnClientThread(this::worldStatus);
            case "status.all" -> runOnClientThread(this::allStatus);
            case "screen.size" -> runOnClientThread(this::screenSize);
            default -> throw new ActionException("INVALID_ACTION");
        };
    }

    private Map<String, Object> performWait(Map<String, Object> params) {
        double seconds = getDouble(params, "seconds", 0.0D);
        int ticks = getInt(params, "ticks", 0);
        double timeoutSeconds = getDouble(params, "timeout", Math.max(DEFAULT_WAIT_TIMEOUT_SECONDS, seconds));

        long waitMillis = (long) Math.max(0, (seconds * 1000.0D) + (ticks * 50L));
        if (waitMillis > 0L) {
            safeSleep(waitMillis);
        }

        long startedAt = System.currentTimeMillis();
        if (getBoolean(params, "untilGuiOpen", false)) {
            pollOnClientThread(timeoutSeconds, () -> client.currentScreen != null, Boolean::booleanValue, "TIMEOUT");
        }
        if (params != null && params.get("untilHealthAbove") != null) {
            double threshold = getDouble(params, "untilHealthAbove");
            pollOnClientThread(
                timeoutSeconds,
                () -> requirePlayer().getHealth() > threshold,
                Boolean::booleanValue,
                "TIMEOUT"
            );
        }
        if (getBoolean(params, "untilOnGround", false)) {
            pollOnClientThread(timeoutSeconds, () -> requirePlayer().isOnGround(), Boolean::booleanValue, "TIMEOUT");
        }

        return Map.of(
            "waitedSeconds", Duration.ofMillis(System.currentTimeMillis() - startedAt + waitMillis).toMillis() / 1000.0D,
            "guiOpen", runOnClientThread(() -> client.currentScreen != null),
            "onGround", runOnClientThread(() -> requirePlayer().isOnGround())
        );
    }

    private Map<String, Object> healthStatus() {
        ClientPlayerEntity player = requirePlayer();
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("health", player.getHealth());
        result.put("maxHealth", player.getMaxHealth());
        result.put("food", player.getHungerManager().getFoodLevel());
        result.put("saturation", player.getHungerManager().getSaturationLevel());
        result.put("absorption", player.getAbsorptionAmount());
        result.put("isDead", player.isDead());
        result.put("deathCount", stateTracker.getDeathCount());
        result.put("recentDeaths", stateTracker.getRecentDeaths(5));
        return result;
    }

    private Map<String, Object> effectsStatus() {
        return Map.of("effects", ClientDataHelper.effectsToList(requirePlayer().getStatusEffects()));
    }

    private Map<String, Object> experienceStatus() {
        ClientPlayerEntity player = requirePlayer();
        return Map.of(
            "level", player.experienceLevel,
            "progress", player.experienceProgress,
            "total", player.totalExperience
        );
    }

    private Map<String, Object> gamemodeStatus() {
        ClientPlayerInteractionManager interactionManager = requireInteractionManager();
        GameMode gameMode = interactionManager.getCurrentGameMode();
        return Map.of("gameMode", gameMode != null ? gameMode.getName() : "unknown");
    }

    private Map<String, Object> worldStatus() {
        ClientPlayerEntity player = requirePlayer();
        return Map.of(
            "name", player.clientWorld.getRegistryKey().getValue().toString(),
            "dimension", player.clientWorld.getRegistryKey().getValue().toString(),
            "difficulty", player.clientWorld.getDifficulty().getName(),
            "time", player.clientWorld.getTime(),
            "weather", player.clientWorld.isThundering() ? "thunder" : player.clientWorld.isRaining() ? "rain" : "clear"
        );
    }

    private Map<String, Object> allStatus() {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("health", healthStatus());
        result.put("effects", effectsStatus());
        result.put("experience", experienceStatus());
        result.put("gamemode", gamemodeStatus());
        result.put("world", worldStatus());
        result.put("position", positionMap(requirePlayer()));
        return result;
    }

    private Map<String, Object> screenSize() {
        return Map.of(
            "width", client.getWindow().getScaledWidth(),
            "height", client.getWindow().getScaledHeight(),
            "scaleFactor", client.getWindow().getScaleFactor()
        );
    }
}
