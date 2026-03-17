package com.mct.version;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ClientActionExecutor.ActionException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.multiplayer.ConnectScreen;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.client.resource.server.ServerResourcePackLoader;
import net.minecraft.scoreboard.Scoreboard;
import net.minecraft.scoreboard.ScoreboardDisplaySlot;
import net.minecraft.scoreboard.ScoreboardEntry;
import net.minecraft.scoreboard.ScoreboardObjective;
import net.minecraft.text.Text;

public final class ClientVersionAdapterFactory {

    private ClientVersionAdapterFactory() {
    }

    public static ClientVersionAdapter create() {
        return new ClientVersionAdapter() {
            @Override
            public String toJsonString(Text text) {
                return Text.Serialization.toJsonString(text);
            }

            @Override
            public Map<String, Object> scoreboardStatus(Scoreboard scoreboard) {
                ScoreboardObjective objective = scoreboard.getObjectiveForSlot(ScoreboardDisplaySlot.SIDEBAR);
                if (objective == null) {
                    return Map.of("title", "", "entries", List.of());
                }

                ArrayList<Map<String, Object>> entries = new ArrayList<>();
                scoreboard.getScoreboardEntries(objective).stream()
                    .filter(entry -> !entry.hidden())
                    .sorted(Comparator.comparingInt(ScoreboardEntry::value).reversed())
                    .forEach(entry -> entries.add(Map.of("name", entry.name().getString(), "score", entry.value())));
                return Map.of("title", objective.getDisplayName().getString(), "entries", entries);
            }

            @Override
            public Map<String, Object> resourcePackStatus(MinecraftClient client, ClientStateTracker stateTracker) {
                requireResourcePackLoader(client);
                return stateTracker.getResourcePackState();
            }

            @Override
            public Map<String, Object> acceptResourcePack(MinecraftClient client, ClientStateTracker stateTracker) {
                requireResourcePackLoader(client).acceptAll();
                return resourcePackStatus(client, stateTracker);
            }

            @Override
            public Map<String, Object> rejectResourcePack(MinecraftClient client, ClientStateTracker stateTracker) {
                requireResourcePackLoader(client).declineAll();
                return resourcePackStatus(client, stateTracker);
            }

            @Override
            public void connect(MinecraftClient client, Screen parent, ServerAddress serverAddress, String address) {
                ServerInfo serverInfo = new ServerInfo("MCT Auto Test", address, ServerInfo.ServerType.OTHER);
                ConnectScreen.connect(parent, client, serverAddress, serverInfo, false);
            }

            private ServerResourcePackLoader requireResourcePackLoader(MinecraftClient client) {
                ServerResourcePackLoader loader = client.getServerResourcePackProvider();
                if (loader == null) {
                    throw new ActionException("INVALID_STATE");
                }
                return loader;
            }
        };
    }
}
