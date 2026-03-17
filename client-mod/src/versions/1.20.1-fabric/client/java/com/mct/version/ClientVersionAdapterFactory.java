package com.mct.version;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ClientActionExecutor.ActionException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.ConnectScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.scoreboard.Scoreboard;
import net.minecraft.scoreboard.ScoreboardObjective;
import net.minecraft.scoreboard.ScoreboardPlayerScore;
import net.minecraft.text.Text;

public final class ClientVersionAdapterFactory {

    private ClientVersionAdapterFactory() {
    }

    public static ClientVersionAdapter create() {
        return new ClientVersionAdapter() {
            @Override
            public String toJsonString(Text text) {
                return Text.Serializer.toJson(text);
            }

            @Override
            public Map<String, Object> scoreboardStatus(Scoreboard scoreboard) {
                ScoreboardObjective objective = scoreboard.getObjectiveForSlot(Scoreboard.SIDEBAR_DISPLAY_SLOT_ID);
                if (objective == null) {
                    return Map.of("title", "", "entries", List.of());
                }

                ArrayList<Map<String, Object>> entries = new ArrayList<>();
                scoreboard.getAllPlayerScores(objective).stream()
                    .sorted(Comparator.comparingInt(ScoreboardPlayerScore::getScore).reversed())
                    .forEach(entry -> entries.add(Map.of("name", entry.getPlayerName(), "score", entry.getScore())));
                return Map.of("title", objective.getDisplayName().getString(), "entries", entries);
            }

            @Override
            public Map<String, Object> resourcePackStatus(MinecraftClient client, ClientStateTracker stateTracker) {
                ServerInfo serverInfo = requireServerInfo(client);
                String acceptanceStatus = switch (serverInfo.getResourcePackPolicy()) {
                    case ENABLED -> "enabled";
                    case DISABLED -> "disabled";
                    case PROMPT -> "prompt";
                };
                stateTracker.recordResourcePackState(acceptanceStatus, 0);
                return stateTracker.getResourcePackState();
            }

            @Override
            public Map<String, Object> acceptResourcePack(MinecraftClient client, ClientStateTracker stateTracker) {
                ServerInfo serverInfo = requireServerInfo(client);
                serverInfo.setResourcePackPolicy(ServerInfo.ResourcePackPolicy.ENABLED);
                stateTracker.recordResourcePackState("enabled", 0);
                return stateTracker.getResourcePackState();
            }

            @Override
            public Map<String, Object> rejectResourcePack(MinecraftClient client, ClientStateTracker stateTracker) {
                ServerInfo serverInfo = requireServerInfo(client);
                serverInfo.setResourcePackPolicy(ServerInfo.ResourcePackPolicy.DISABLED);
                stateTracker.recordResourcePackState("disabled", 0);
                return stateTracker.getResourcePackState();
            }

            @Override
            public void connect(MinecraftClient client, Screen parent, ServerAddress serverAddress, String address) {
                ServerInfo serverInfo = new ServerInfo("MCT Auto Test", address, false);
                ConnectScreen.connect(parent, client, serverAddress, serverInfo, false);
            }

            private ServerInfo requireServerInfo(MinecraftClient client) {
                ServerInfo serverInfo = client.getCurrentServerEntry();
                if (serverInfo == null) {
                    throw new ActionException("INVALID_STATE");
                }
                return serverInfo;
            }
        };
    }
}
