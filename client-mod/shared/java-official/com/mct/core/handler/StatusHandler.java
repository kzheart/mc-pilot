package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.*;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.core.util.ClientDataHelper;
import com.mct.core.util.SessionReliability;
import com.mct.version.ClientVersionModulesHolder;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.DeathScreen;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.level.GameType;

public final class StatusHandler extends ActionHandler {

    private static final double DEFAULT_WAIT_TIMEOUT_SECONDS = 10.0D;

    public StatusHandler(Minecraft client, ClientStateTracker stateTracker) {
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
            pollOnClientThread(timeoutSeconds, () -> ClientVersionModulesHolder.get().compatibility().getScreen(client) != null, Boolean::booleanValue, "TIMEOUT");
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
            pollOnClientThread(timeoutSeconds, () -> requirePlayer().onGround(), Boolean::booleanValue, "TIMEOUT");
        }

        return com.mct.core.util.MctMaps.mapOf(
            "waitedSeconds", Duration.ofMillis(System.currentTimeMillis() - startedAt + waitMillis).toMillis() / 1000.0D,
            "guiOpen", runOnClientThread(() -> ClientVersionModulesHolder.get().compatibility().getScreen(client) != null),
            "onGround", runOnClientThread(() -> requirePlayer().onGround())
        );
    }

    private Map<String, Object> healthStatus() {
        LocalPlayer player = requirePlayer();
        boolean onDeathScreen = ClientVersionModulesHolder.get().compatibility().getScreen(client) instanceof DeathScreen;
        boolean isDead = player.isDeadOrDying() || player.getHealth() <= 0.0F;
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("health", player.getHealth());
        result.put("maxHealth", player.getMaxHealth());
        result.put("food", player.getFoodData().getFoodLevel());
        result.put("saturation", player.getFoodData().getSaturationLevel());
        result.put("absorption", player.getAbsorptionAmount());
        result.put("isDead", isDead);
        result.put("awaitingRespawn", isDead || onDeathScreen);
        result.put("onDeathScreen", onDeathScreen);
        result.put("deathCount", stateTracker.getDeathCount());
        result.put("recentDeaths", stateTracker.getRecentDeaths(5));
        return result;
    }

    private Map<String, Object> effectsStatus() {
        return com.mct.core.util.MctMaps.mapOf("effects", ClientDataHelper.effectsToList(requirePlayer().getActiveEffects()));
    }

    private Map<String, Object> experienceStatus() {
        LocalPlayer player = requirePlayer();
        int nextLevelPoints = experiencePointsForLevel(player.experienceLevel);
        int points = Math.min(nextLevelPoints, Math.max(0, Math.round(player.experienceProgress * nextLevelPoints)));

        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("level", player.experienceLevel);
        result.put("progress", player.experienceProgress);
        result.put("points", points);
        result.put("nextLevelPoints", nextLevelPoints);
        result.put("pointsToNextLevel", Math.max(0, nextLevelPoints - points));
        result.put("totalExperience", experiencePointsToReachLevel(player.experienceLevel) + points);
        return result;
    }

    private int experiencePointsForLevel(int level) {
        if (level >= 30) {
            return 9 * level - 158;
        }
        if (level >= 15) {
            return 5 * level - 38;
        }
        return 2 * level + 7;
    }

    private int experiencePointsToReachLevel(int level) {
        if (level <= 16) {
            return (level * level) + (6 * level);
        }
        if (level <= 31) {
            return (int) Math.round((2.5D * level * level) - (40.5D * level) + 360.0D);
        }
        return (int) Math.round((4.5D * level * level) - (162.5D * level) + 2220.0D);
    }

    private Map<String, Object> gamemodeStatus() {
        MultiPlayerGameMode interactionManager = requireInteractionManager();
        GameType gameMode = interactionManager.getPlayerMode();
        return com.mct.core.util.MctMaps.mapOf("gameMode", gameMode != null ? ClientVersionModulesHolder.get().compatibility().gameModeName(gameMode) : "unknown");
    }

    private Map<String, Object> worldStatus() {
        LocalPlayer player = requirePlayer();
        net.minecraft.client.multiplayer.ClientLevel world = clientWorld(player);
        return com.mct.core.util.MctMaps.mapOf(
            "name", world.dimension().identifier().toString(),
            "dimension", world.dimension().identifier().toString(),
            "difficulty", ClientVersionModulesHolder.get().compatibility().worldDifficultyName(world),
            "time", ClientVersionModulesHolder.get().compatibility().worldTime(world),
            "weather", world.isThundering() ? "thunder" : world.isRaining() ? "rain" : "clear"
        );
    }

    private Map<String, Object> allStatus() {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("screen", ClientDataHelper.screenToMap(client));
        result.put("screenCategory", SessionReliability.screenCategory(client));
        result.put("disconnectReason", SessionReliability.disconnectReason(client));
        try {
            result.put("health", healthStatus());
            result.put("effects", effectsStatus());
            result.put("experience", experienceStatus());
            result.put("gamemode", gamemodeStatus());
            result.put("world", worldStatus());
            result.put("position", positionMap(requirePlayer()));
            result.put("inWorld", true);
        } catch (ActionException exception) {
            if (!"NOT_IN_WORLD".equals(exception.getCode())) {
                throw exception;
            }
            SessionReliability.tryAutoReconnect(client, stateTracker);
            result.put("inWorld", false);
        }
        return result;
    }

    private Map<String, Object> screenSize() {
        return com.mct.core.util.MctMaps.mapOf(
            "width", client.getWindow().getGuiScaledWidth(),
            "height", client.getWindow().getGuiScaledHeight(),
            "scaleFactor", client.getWindow().getGuiScale()
        );
    }
}
