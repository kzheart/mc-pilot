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
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.DeathScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.scores.PlayerTeam;

public final class SessionHandler extends ActionHandler {

    public SessionHandler(Minecraft client, ClientStateTracker stateTracker) {
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
        return ClientVersionModulesHolder.get().scoreboard().scoreboardStatus(clientWorld(requirePlayer()).getScoreboard());
    }

    private Map<String, Object> tabStatus() {
        ClientPacketListener networkHandler = requirePlayer().connection;
        ArrayList<Map<String, Object>> players = new ArrayList<>();
        for (PlayerInfo entry : networkHandler.getOnlinePlayers()) {
            players.add(
                ClientDataHelper.playerListEntryToMap(
                    entry,
                    ClientVersionModulesHolder.get().compatibility().getTabList(client).getNameForDisplay(entry),
                    entry.getTeam()
                )
            );
        }
        LinkedHashMap<String, Object> result = new LinkedHashMap<>(stateTracker.getTabListState());
        result.put("players", players);
        return result;
    }

    private Map<String, Object> bossBarStatus() {
        return com.mct.core.util.MctMaps.mapOf("bossBars", stateTracker.getBossBars());
    }

    private Map<String, Object> actionBarStatus() {
        return stateTracker.getActionBarState();
    }

    private Map<String, Object> titleStatus() {
        return stateTracker.getTitleState();
    }

    private Map<String, Object> nameTagStatus(String playerName) {
        ClientPacketListener networkHandler = requirePlayer().connection;
        Optional<PlayerInfo> entry = networkHandler.getOnlinePlayers().stream()
            .filter(candidate -> ClientVersionModulesHolder.get().compatibility().profileName(candidate).equalsIgnoreCase(playerName))
            .findFirst();
        if (entry.isEmpty()) {
            throw new ActionException("ENTITY_NOT_FOUND");
        }
        PlayerTeam team = entry.get().getTeam();
        return com.mct.core.util.MctMaps.mapOf(
            "displayName", ClientVersionModulesHolder.get().compatibility().getTabList(client).getNameForDisplay(entry.get()).getString(),
            "prefix", team != null ? team.getPlayerPrefix().getString() : "",
            "suffix", team != null ? team.getPlayerSuffix().getString() : ""
        );
    }

    private Map<String, Object> resourcePackStatus() {
        return ClientVersionModulesHolder.get().resourcePack().status(client, stateTracker);
    }

    private Map<String, Object> respawnPlayer() {
        LocalPlayer player = requirePlayer();
        boolean wasDead = player.isDeadOrDying() || player.getHealth() <= 0.0F;
        boolean wasOnDeathScreen = ClientVersionModulesHolder.get().compatibility().getScreen(client) instanceof DeathScreen;
        player.respawn();
        if (wasOnDeathScreen) {
            ClientVersionModulesHolder.get().compatibility().setScreen(client, null);
        }
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("requested", true);
        result.put("wasDead", wasDead);
        result.put("wasOnDeathScreen", wasOnDeathScreen);
        return result;
    }

    private Map<String, Object> reconnectClient(Map<String, Object> params) {
        String address = getOptionalString(params, "address");
        if (address == null || address.trim().isEmpty()) {
            address = System.getenv("MCT_CLIENT_SERVER");
        }
        if (address == null || address.trim().isEmpty() || !ServerAddress.isValidAddress(address)) {
            throw new ActionException("INVALID_PARAMS");
        }

        Screen currentScreen = ClientVersionModulesHolder.get().compatibility().getScreen(client);
        Screen parent = currentScreen != null ? currentScreen : new TitleScreen();
        ServerAddress serverAddress = ServerAddress.parseString(address);
        ClientVersionModulesHolder.get().reconnect().connect(client, parent, serverAddress, address);
        return com.mct.core.util.MctMaps.mapOf("connecting", true, "address", address);
    }
}
