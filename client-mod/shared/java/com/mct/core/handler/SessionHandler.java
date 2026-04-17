package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.*;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.core.util.ClientDataHelper;
import com.mct.version.ClientVersionModulesHolder;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.DeathScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ClientPlayNetworkHandler;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.scoreboard.Team;

public final class SessionHandler extends ActionHandler {

    public SessionHandler(MinecraftClient client, ClientStateTracker stateTracker) {
        super(client, stateTracker);
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
            case "hud.scoreboard" -> runOnClientThread(this::scoreboardStatus);
            case "hud.tab" -> runOnClientThread(this::tabStatus);
            case "hud.bossbar" -> runOnClientThread(this::bossBarStatus);
            case "hud.actionbar" -> runOnClientThread(this::actionBarStatus);
            case "hud.title" -> runOnClientThread(this::titleStatus);
            case "hud.nametag" -> runOnClientThread(() -> nameTagStatus(getString(params, "player")));
            case "client.reconnect" -> runOnClientThread(() -> reconnectClient(params));
            case "client.respawn" -> runOnClientThread(() -> respawnPlayer());
            case "resourcepack.status" -> runOnClientThread(this::resourcePackStatus);
            case "resourcepack.accept" -> runOnClientThread(() -> ClientVersionModulesHolder.get().resourcePack().accept(client, stateTracker));
            case "resourcepack.reject" -> runOnClientThread(() -> ClientVersionModulesHolder.get().resourcePack().reject(client, stateTracker));
            default -> throw new ActionException("INVALID_ACTION");
        };
    }

    private Map<String, Object> scoreboardStatus() {
        return ClientVersionModulesHolder.get().scoreboard().scoreboardStatus(requirePlayer().clientWorld.getScoreboard());
    }

    private Map<String, Object> tabStatus() {
        ClientPlayNetworkHandler networkHandler = requirePlayer().networkHandler;
        ArrayList<Map<String, Object>> players = new ArrayList<>();
        for (PlayerListEntry entry : networkHandler.getPlayerList()) {
            players.add(
                ClientDataHelper.playerListEntryToMap(
                    entry,
                    client.inGameHud.getPlayerListHud().getPlayerName(entry),
                    entry.getScoreboardTeam()
                )
            );
        }
        LinkedHashMap<String, Object> result = new LinkedHashMap<>(stateTracker.getTabListState());
        result.put("players", players);
        return result;
    }

    private Map<String, Object> bossBarStatus() {
        return Map.of("bossBars", stateTracker.getBossBars());
    }

    private Map<String, Object> actionBarStatus() {
        return stateTracker.getActionBarState();
    }

    private Map<String, Object> titleStatus() {
        return stateTracker.getTitleState();
    }

    private Map<String, Object> nameTagStatus(String playerName) {
        ClientPlayNetworkHandler networkHandler = requirePlayer().networkHandler;
        Optional<PlayerListEntry> entry = networkHandler.getPlayerList().stream()
            .filter(candidate -> candidate.getProfile().getName().equalsIgnoreCase(playerName))
            .findFirst();
        if (entry.isEmpty()) {
            throw new ActionException("ENTITY_NOT_FOUND");
        }
        Team team = entry.get().getScoreboardTeam();
        return Map.of(
            "displayName", client.inGameHud.getPlayerListHud().getPlayerName(entry.get()).getString(),
            "prefix", team != null ? team.getPrefix().getString() : "",
            "suffix", team != null ? team.getSuffix().getString() : ""
        );
    }

    private Map<String, Object> resourcePackStatus() {
        return ClientVersionModulesHolder.get().resourcePack().status(client, stateTracker);
    }

    private Map<String, Object> respawnPlayer() {
        ClientPlayerEntity player = requirePlayer();
        boolean wasDead = player.isDead() || player.getHealth() <= 0.0F;
        boolean wasOnDeathScreen = client.currentScreen instanceof DeathScreen;
        player.requestRespawn();
        if (wasOnDeathScreen) {
            client.setScreen(null);
        }
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("requested", true);
        result.put("wasDead", wasDead);
        result.put("wasOnDeathScreen", wasOnDeathScreen);
        return result;
    }

    private Map<String, Object> reconnectClient(Map<String, Object> params) {
        String address = getOptionalString(params, "address");
        if (address == null || address.isBlank()) {
            address = System.getenv("MCT_CLIENT_SERVER");
        }
        if (address == null || address.isBlank() || !ServerAddress.isValid(address)) {
            throw new ActionException("INVALID_PARAMS");
        }

        Screen parent = client.currentScreen != null ? client.currentScreen : new TitleScreen();
        ServerAddress serverAddress = ServerAddress.parse(address);
        ClientVersionModulesHolder.get().reconnect().connect(client, parent, serverAddress, address);
        return Map.of("connecting", true, "address", address);
    }
}
