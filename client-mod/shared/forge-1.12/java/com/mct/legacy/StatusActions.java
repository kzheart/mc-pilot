package com.mct.legacy;

import com.google.gson.JsonObject;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.entity.EntityPlayerSP;
import net.minecraft.client.gui.GuiGameOver;
import net.minecraft.client.gui.ScaledResolution;

/** position.get / rotation.get / status.* / screen.size / wait.perform */
public final class StatusActions extends LegacyActions {

    private static final double DEFAULT_WAIT_TIMEOUT_SECONDS = 10.0D;

    @Override
    public Map<String, Object> handle(String action, JsonObject params) {
        if ("position.get".equals(action)) {
            return onClient(() -> positionMap(requirePlayer()));
        }
        if ("rotation.get".equals(action)) {
            return onClient(() -> rotationMap(requirePlayer()));
        }
        if ("wait.perform".equals(action)) {
            return performWait(params);
        }
        if ("status.health".equals(action)) {
            return onClient(this::healthStatus);
        }
        if ("status.effects".equals(action)) {
            return onClient(() -> map("effects", Data.effectsToList(requirePlayer().getActivePotionEffects())));
        }
        if ("status.experience".equals(action)) {
            return onClient(this::experienceStatus);
        }
        if ("status.gamemode".equals(action)) {
            return onClient(this::gamemodeStatus);
        }
        if ("status.world".equals(action)) {
            return onClient(this::worldStatus);
        }
        if ("status.all".equals(action)) {
            return onClient(this::allStatus);
        }
        if ("screen.size".equals(action)) {
            return onClient(this::screenSize);
        }
        throw new LegacyActionException("INVALID_ACTION");
    }

    private Map<String, Object> performWait(JsonObject params) {
        double seconds = Params.doubleValue(params, "seconds", 0.0D);
        int ticks = Params.intValue(params, "ticks", 0);
        double timeoutSeconds = Params.doubleValue(params, "timeout", Math.max(DEFAULT_WAIT_TIMEOUT_SECONDS, seconds));

        long waitMillis = (long) Math.max(0, (seconds * 1000.0D) + (ticks * 50L));
        if (waitMillis > 0L) {
            MainThread.sleep(waitMillis);
        }

        long startedAt = System.currentTimeMillis();
        if (Params.booleanValue(params, "untilGuiOpen", false)) {
            pollOnClient(timeoutSeconds, () -> client.currentScreen != null, done -> done, "TIMEOUT");
        }
        if (Params.has(params, "untilHealthAbove")) {
            double threshold = Params.requireDouble(params, "untilHealthAbove");
            pollOnClient(timeoutSeconds, () -> requirePlayer().getHealth() > threshold, done -> done, "TIMEOUT");
        }
        if (Params.booleanValue(params, "untilOnGround", false)) {
            pollOnClient(timeoutSeconds, () -> requirePlayer().onGround, done -> done, "TIMEOUT");
        }

        return map(
            "waitedSeconds", (System.currentTimeMillis() - startedAt + waitMillis) / 1000.0D,
            "guiOpen", onClient(() -> client.currentScreen != null),
            "onGround", onClient(() -> requirePlayer().onGround)
        );
    }

    private Map<String, Object> healthStatus() {
        EntityPlayerSP player = requirePlayer();
        boolean onDeathScreen = client.currentScreen instanceof GuiGameOver;
        boolean isDead = player.isDead || player.getHealth() <= 0.0F;
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("health", player.getHealth());
        result.put("maxHealth", player.getMaxHealth());
        result.put("food", player.getFoodStats().getFoodLevel());
        result.put("saturation", player.getFoodStats().getSaturationLevel());
        result.put("absorption", player.getAbsorptionAmount());
        result.put("isDead", isDead);
        result.put("awaitingRespawn", isDead || onDeathScreen);
        result.put("onDeathScreen", onDeathScreen);
        return result;
    }

    private Map<String, Object> experienceStatus() {
        EntityPlayerSP player = requirePlayer();
        int nextLevelPoints = experiencePointsForLevel(player.experienceLevel);
        int points = Math.min(nextLevelPoints, Math.max(0, Math.round(player.experience * nextLevelPoints)));
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("level", player.experienceLevel);
        result.put("progress", player.experience);
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
        requirePlayer();
        return map("gameMode", requireController().getCurrentGameType().getName());
    }

    private Map<String, Object> worldStatus() {
        requirePlayer();
        String dimension = client.world.provider.getDimensionType().getName();
        return map(
            "name", dimension,
            "dimension", dimension,
            "difficulty", client.world.getDifficulty().name().toLowerCase(java.util.Locale.ROOT),
            "time", client.world.getWorldTime(),
            "weather", client.world.isThundering() ? "thunder" : client.world.isRaining() ? "rain" : "clear"
        );
    }

    private Map<String, Object> allStatus() {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("screen", Data.screenToMap(client));
        result.put("screenCategory", Data.screenCategory(client));
        result.put("disconnectReason", Data.disconnectReason(client));
        try {
            result.put("health", healthStatus());
            result.put("effects", map("effects", Data.effectsToList(requirePlayer().getActivePotionEffects())));
            result.put("experience", experienceStatus());
            result.put("gamemode", gamemodeStatus());
            result.put("world", worldStatus());
            result.put("position", positionMap(requirePlayer()));
            result.put("inWorld", true);
        } catch (LegacyActionException exception) {
            if (!"NOT_IN_WORLD".equals(exception.code)) {
                throw exception;
            }
            result.put("inWorld", false);
        }
        return result;
    }

    private Map<String, Object> screenSize() {
        ScaledResolution resolution = new ScaledResolution(client);
        return map(
            "width", resolution.getScaledWidth(),
            "height", resolution.getScaledHeight(),
            "scaleFactor", resolution.getScaleFactor()
        );
    }
}
