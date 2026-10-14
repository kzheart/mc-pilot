package com.mct.legacy;

import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.entity.EntityPlayerSP;
import net.minecraft.client.gui.GuiGameOver;
import net.minecraft.client.gui.GuiIngame;
import net.minecraft.client.gui.GuiMainMenu;
import net.minecraft.client.gui.GuiPlayerTabOverlay;
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

    private final LegacyResourcePacks resourcePacks;
    // Native-screen identity, not a global lock: leaving this screen ends reuse.
    private GuiConnecting requestedConnectingScreen;
    private String requestedConnectingPolicy;

    public SessionActions(LegacyResourcePacks resourcePacks) {
        this.resourcePacks = resourcePacks;
    }

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
            return onClient(resourcePacks::status);
        }
        if ("resourcepack.accept".equals(action)) {
            return onClient(() -> resourcePacks.answer(true));
        }
        if ("resourcepack.reject".equals(action)) {
            return onClient(() -> resourcePacks.answer(false));
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
        TitleTracker tracker = LegacyForgeEntrypoint.titleTracker();
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("title", tracker != null ? tracker.title() : "");
        result.put("subtitle", tracker != null ? tracker.subtitle() : "");
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
        final String target = canonicalAddress(address);
        final String serverAddress = address;
        String requestedPolicy = Params.has(params, "resourcePackPolicy") ? Params.string(params, "resourcePackPolicy") : null;
        final String policy;
        try { policy = com.mct.core.resourcepack.ResourcePackPolicy.parse(requestedPolicy); }
        catch (IllegalArgumentException invalid) { throw new LegacyActionException("INVALID_PARAMS"); }

        // The two phases may interleave with another socket. Check native state
        // before disconnecting and again atomically with constructing its screen.
        int disconnectState = onClient(() -> {
            if (isConnectingTo(target, policy)) return -1;
            if (client.player != null && client.player.connection != null) {
                client.player.connection.getNetworkManager()
                    .closeChannel(new net.minecraft.util.text.TextComponentString("mct reconnect"));
                return 1;
            }
            return 0;
        });
        if (disconnectState < 0) return map("connecting", true, "address", target, "alreadyConnecting", true);
        // Let native disconnect run outside its scheduled-task queue monitor.
        if (disconnectState > 0) {
            Boolean disconnected = pollUntil(5.0D,
                () -> client.world == null || isConnectingTo(target, policy), done -> done);
            if (!Boolean.TRUE.equals(disconnected)) {
                throw new LegacyActionException("TIMEOUT", "Disconnect did not finish; new connection was not started");
            }
        }
        boolean started = onClient(() -> {
            if (isConnectingTo(target, policy)) return false;
            // A skipped duplicate must not alter policy or pending pack state.
            resourcePacks.setOverride(serverAddress, policy);
            ServerData serverData = resourcePacks.connectionInfo(serverAddress);
            GuiConnecting screen = new GuiConnecting(new GuiMainMenu(), client, serverData);
            requestedConnectingScreen = screen;
            requestedConnectingPolicy = policy;
            client.displayGuiScreen(screen);
            return true;
        });
        return map("connecting", true, "address", target, "alreadyConnecting", !started);
    }

    private boolean isConnectingTo(String target, String policy) {
        if (!(client.currentScreen instanceof GuiConnecting)) return false;
        ServerData current = client.getCurrentServerData();
        if (current == null) throw new LegacyActionException("INVALID_STATE", "A connection to an unknown server is already in progress; wait for it to finish before connecting to " + target);
        final String currentTarget;
        try { currentTarget = canonicalAddress(current.serverIP); }
        catch (LegacyActionException invalid) { throw new LegacyActionException("INVALID_STATE", "A connection to an unknown server is already in progress; wait for it to finish before connecting to " + target); }
        if (!target.equals(currentTarget)) {
            throw new LegacyActionException("INVALID_STATE", "A connection to " + currentTarget + " is already in progress; wait for it to finish before connecting to " + target);
        }
        if (policy != null && (client.currentScreen != requestedConnectingScreen || !policy.equals(requestedConnectingPolicy))) {
            throw new LegacyActionException("INVALID_STATE", "A connection to this server is already in progress with another or unknown resource-pack policy");
        }
        return true;
    }

    private static String canonicalAddress(String address) {
        try {
            // Unlike vanilla ServerAddress.fromString, this parser does no DNS
            // SRV lookup on the game thread. Guava is already shipped by 1.12.
            if (address == null) throw new IllegalArgumentException("Missing address");
            com.google.common.net.HostAndPort parsed = com.google.common.net.HostAndPort.fromString(address.trim()).withDefaultPort(25565);
            String host = parsed.getHost();
            if (host.isEmpty()) throw new IllegalArgumentException("Empty host");
            if (com.google.common.net.InetAddresses.isInetAddress(host)) {
                host = com.google.common.net.InetAddresses.toAddrString(com.google.common.net.InetAddresses.forString(host));
            } else {
                host = java.net.IDN.toASCII(host).toLowerCase(java.util.Locale.ROOT);
            }
            return com.google.common.net.HostAndPort.fromParts(host, parsed.getPort()).toString();
        } catch (IllegalArgumentException invalid) {
            throw new LegacyActionException("INVALID_PARAMS");
        }
    }

}
