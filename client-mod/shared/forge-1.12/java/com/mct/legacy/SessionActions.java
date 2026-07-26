package com.mct.legacy;

import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.entity.EntityPlayerSP;
import net.minecraft.client.gui.GuiButton;
import net.minecraft.client.gui.GuiGameOver;
import net.minecraft.client.gui.GuiIngame;
import net.minecraft.client.gui.GuiMainMenu;
import net.minecraft.client.gui.GuiPlayerTabOverlay;
import net.minecraft.client.gui.GuiScreen;
import net.minecraft.client.gui.GuiYesNo;
import net.minecraft.client.gui.BossInfoClient;
import net.minecraft.client.gui.GuiBossOverlay;
import net.minecraft.client.multiplayer.GuiConnecting;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.network.NetworkPlayerInfo;
import net.minecraft.scoreboard.Score;
import net.minecraft.scoreboard.ScoreObjective;
import net.minecraft.scoreboard.ScorePlayerTeam;
import net.minecraft.scoreboard.Scoreboard;
import net.minecraft.util.text.ITextComponent;

/** hud.* / client.reconnect / client.respawn / resourcepack.* */
public final class SessionActions extends LegacyActions {

    private volatile String resourcePackStatus = "pending";
    private volatile int resourcePackCount;

    @Override
    public Map<String, Object> handle(String action, JsonObject params) {
        if ("hud.scoreboard".equals(action)) {
            return onClient(this::scoreboardStatus);
        }
        if ("hud.tab".equals(action)) {
            return onClient(this::tabStatus);
        }
        if ("hud.bossbar".equals(action)) {
            return onClient(this::bossBarStatus);
        }
        if ("hud.actionbar".equals(action)) {
            return onClient(() -> {
                Map<String, Object> state = LegacyForgeEntrypoint.chatRecorder().actionBarState();
                if (String.valueOf(state.get("text")).isEmpty()) {
                    // /title <p> actionbar goes through SPacketTitle, not chat type 2.
                    String overlay = ingameStringField("overlayMessage", "field_73838_g");
                    state.put("text", overlay);
                    state.put("raw", overlay);
                }
                return state;
            });
        }
        if ("hud.title".equals(action)) {
            return onClient(this::titleStatus);
        }
        if ("hud.nametag".equals(action)) {
            return onClient(() -> nameTagStatus(Params.requireString(params, "player")));
        }
        if ("client.reconnect".equals(action)) {
            return reconnectClient(params);
        }
        if ("client.respawn".equals(action)) {
            return onClient(this::respawnPlayer);
        }
        if ("resourcepack.status".equals(action)) {
            return onClient(this::resourcePackStatusMap);
        }
        if ("resourcepack.accept".equals(action)) {
            return onClient(() -> answerResourcePackPrompt(true));
        }
        if ("resourcepack.reject".equals(action)) {
            return onClient(() -> answerResourcePackPrompt(false));
        }
        throw new LegacyActionException("INVALID_ACTION");
    }

    private Map<String, Object> scoreboardStatus() {
        requirePlayer();
        Scoreboard scoreboard = client.world.getScoreboard();
        ScoreObjective objective = scoreboard.getObjectiveInDisplaySlot(1);
        if (objective == null) {
            return map("title", "", "entries", new ArrayList<Object>());
        }
        List<Score> scores = new ArrayList<Score>(scoreboard.getSortedScores(objective));
        scores.sort(Comparator.comparingInt(Score::getScorePoints).reversed());
        List<Map<String, Object>> entries = new ArrayList<Map<String, Object>>();
        for (Score score : scores) {
            entries.add(map("name", score.getPlayerName(), "score", score.getScorePoints()));
        }
        return map("title", objective.getDisplayName(), "entries", entries);
    }

    private Map<String, Object> tabStatus() {
        EntityPlayerSP player = requirePlayer();
        GuiPlayerTabOverlay overlay = client.ingameGUI.getTabList();
        List<Map<String, Object>> players = new ArrayList<Map<String, Object>>();
        for (NetworkPlayerInfo info : player.connection.getPlayerInfoMap()) {
            Map<String, Object> entry = new LinkedHashMap<String, Object>();
            String profileName = info.getGameProfile().getName();
            entry.put("name", profileName);
            entry.put("displayName", tabDisplayName(overlay, info, profileName));
            entry.put("latency", info.getResponseTime());
            entry.put("gameMode", info.getGameType() != null ? info.getGameType().getName() : "unknown");
            ScorePlayerTeam team = info.getPlayerTeam();
            if (team != null) {
                entry.put("team", team.getName());
                entry.put("prefix", team.getPrefix());
                entry.put("suffix", team.getSuffix());
            }
            players.add(entry);
        }
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("header", overlayText(overlay, "header", "field_175256_i"));
        result.put("footer", overlayText(overlay, "footer", "field_175255_h"));
        result.put("players", players);
        return result;
    }

    private String tabDisplayName(GuiPlayerTabOverlay overlay, NetworkPlayerInfo info, String fallback) {
        try {
            String name = overlay.getPlayerName(info);
            return name != null ? name : fallback;
        } catch (RuntimeException ignored) {
            return fallback;
        }
    }

    private String overlayText(GuiPlayerTabOverlay overlay, String mcpName, String srgName) {
        try {
            Object value = Reflect.get(overlay, GuiPlayerTabOverlay.class, mcpName, srgName);
            return value instanceof ITextComponent ? ((ITextComponent) value).getUnformattedText() : "";
        } catch (RuntimeException ignored) {
            return "";
        }
    }

    private Map<String, Object> bossBarStatus() {
        requirePlayer();
        List<Map<String, Object>> values = new ArrayList<Map<String, Object>>();
        try {
            GuiBossOverlay overlay = client.ingameGUI.getBossOverlay();
            Map<?, ?> infos = Reflect.get(overlay, GuiBossOverlay.class, "mapBossInfos", "field_184060_g");
            for (Object value : infos.values()) {
                BossInfoClient info = (BossInfoClient) value;
                values.add(map(
                    "name", info.getName().getUnformattedText(),
                    "progress", info.getPercent(),
                    "color", info.getColor().name().toLowerCase(java.util.Locale.ROOT),
                    "style", info.getOverlay().name().toLowerCase(java.util.Locale.ROOT)
                ));
            }
        } catch (RuntimeException ignored) {
        }
        return map("bossBars", values);
    }

    private Map<String, Object> titleStatus() {
        requirePlayer();
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("title", ingameStringField("displayedTitle", "field_175201_x"));
        result.put("subtitle", ingameStringField("displayedSubTitle", "field_175200_y"));
        result.put("fadeIn", 0);
        result.put("stay", 0);
        result.put("fadeOut", 0);
        return result;
    }

    private String ingameStringField(String mcpName, String srgName) {
        try {
            Object value = Reflect.get(client.ingameGUI, GuiIngame.class, mcpName, srgName);
            return value != null ? stripFormatting(String.valueOf(value)) : "";
        } catch (RuntimeException ignored) {
            return "";
        }
    }

    private String stripFormatting(String value) {
        return value.replaceAll("§.", "");
    }

    private Map<String, Object> nameTagStatus(String playerName) {
        EntityPlayerSP player = requirePlayer();
        for (NetworkPlayerInfo info : player.connection.getPlayerInfoMap()) {
            if (!info.getGameProfile().getName().equalsIgnoreCase(playerName)) {
                continue;
            }
            ScorePlayerTeam team = info.getPlayerTeam();
            return map(
                "displayName", tabDisplayName(client.ingameGUI.getTabList(), info, info.getGameProfile().getName()),
                "prefix", team != null ? team.getPrefix() : "",
                "suffix", team != null ? team.getSuffix() : ""
            );
        }
        throw new LegacyActionException("ENTITY_NOT_FOUND");
    }

    private Map<String, Object> respawnPlayer() {
        EntityPlayerSP player = requirePlayer();
        boolean wasDead = player.isDead || player.getHealth() <= 0.0F;
        boolean wasOnDeathScreen = client.currentScreen instanceof GuiGameOver;
        player.respawnPlayer();
        if (wasOnDeathScreen) {
            client.displayGuiScreen(null);
        }
        return map("requested", true, "wasDead", wasDead, "wasOnDeathScreen", wasOnDeathScreen);
    }

    private Map<String, Object> reconnectClient(JsonObject params) {
        String address = Params.has(params, "address") ? Params.string(params, "address").trim() : "";
        if (address.isEmpty()) {
            String fallback = System.getenv("MCT_CLIENT_SERVER");
            address = fallback != null ? fallback.trim() : "";
        }
        if (address.isEmpty()) {
            throw new LegacyActionException("INVALID_PARAMS");
        }
        String host = address;
        int port = 25565;
        int separator = address.lastIndexOf(':');
        if (separator > 0) {
            host = address.substring(0, separator);
            try {
                port = Integer.parseInt(address.substring(separator + 1));
            } catch (NumberFormatException exception) {
                throw new LegacyActionException("INVALID_PARAMS");
            }
        }
        // Calling loadWorld(null) from a scheduled task deadlocks the client thread;
        // close the channel instead and let vanilla's own disconnect flow run.
        boolean hadWorld = onClient(() -> {
            if (client.player != null && client.player.connection != null) {
                client.player.connection.getNetworkManager()
                    .closeChannel(new net.minecraft.util.text.TextComponentString("mct reconnect"));
                return true;
            }
            return false;
        });
        if (hadWorld) {
            pollUntil(5.0D, () -> client.world == null, done -> done);
        }
        String serverAddress = address;
        onClient(() -> {
            ServerData serverData = new ServerData("mct", serverAddress, false);
            client.displayGuiScreen(new GuiConnecting(new GuiMainMenu(), client, serverData));
            return true;
        });
        return map("connecting", true, "address", host + ":" + port);
    }

    private Map<String, Object> resourcePackStatusMap() {
        if (client.currentScreen instanceof GuiYesNo) {
            resourcePackStatus = "pending";
            resourcePackCount = Math.max(1, resourcePackCount);
            return currentResourcePackState();
        }
        if ("pending".equals(resourcePackStatus)) {
            ServerData serverData = client.getCurrentServerData();
            if (serverData != null) {
                if (serverData.getResourceMode() == ServerData.ServerResourceMode.ENABLED) {
                    resourcePackStatus = "enabled";
                } else if (serverData.getResourceMode() == ServerData.ServerResourceMode.DISABLED) {
                    resourcePackStatus = "disabled";
                } else {
                    resourcePackStatus = "prompt";
                }
            }
        }
        return currentResourcePackState();
    }

    private Map<String, Object> currentResourcePackState() {
        return map("acceptanceStatus", resourcePackStatus, "packCount", resourcePackCount);
    }

    private Map<String, Object> answerResourcePackPrompt(boolean accept) {
        GuiScreen screen = client.currentScreen;
        if (screen instanceof GuiYesNo) {
            List<?> buttons = Reflect.get(screen, GuiScreen.class, "buttonList", "field_146292_n");
            GuiButton target = null;
            for (Object value : buttons) {
                GuiButton button = (GuiButton) value;
                if ((accept && button.id == 0) || (!accept && button.id == 1)) {
                    target = button;
                    break;
                }
            }
            if (target != null) {
                Reflect.invoke(
                    screen, GuiScreen.class,
                    new Class<?>[] {GuiButton.class}, new Object[] {target},
                    "actionPerformed", "func_146284_a"
                );
                resourcePackStatus = accept ? "allowed" : "declined";
                resourcePackCount = accept ? Math.max(1, resourcePackCount) : 0;
                return currentResourcePackState();
            }
        }
        resourcePackStatus = accept ? "allowed" : "declined";
        return currentResourcePackState();
    }
}
