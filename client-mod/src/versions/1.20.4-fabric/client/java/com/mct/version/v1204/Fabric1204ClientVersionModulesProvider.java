package com.mct.version.v1204;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ClientActionExecutor.ActionException;
import com.mct.version.ClientVersionModules;
import com.mct.version.ClientVersionModulesProvider;
import com.mct.version.ResourcePackAdapter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.multiplayer.ConnectScreen;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.client.resource.server.ServerResourcePackLoader;
import net.minecraft.scoreboard.Scoreboard;
import net.minecraft.scoreboard.ScoreboardDisplaySlot;
import net.minecraft.scoreboard.ScoreboardEntry;
import net.minecraft.scoreboard.ScoreboardObjective;
import net.minecraft.text.Text;

public final class Fabric1204ClientVersionModulesProvider implements ClientVersionModulesProvider {

    @Override
    public ClientVersionModules create() {
        return new ClientVersionModules(
            Text.Serialization::toJsonString,
            scoreboard -> {
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
            },
            new ResourcePackAdapter() {
                @Override
                public Map<String, Object> status(MinecraftClient client, ClientStateTracker stateTracker) {
                    requireResourcePackLoader(client);
                    return stateTracker.getResourcePackState();
                }

                @Override
                public Map<String, Object> accept(MinecraftClient client, ClientStateTracker stateTracker) {
                    requireResourcePackLoader(client).acceptAll();
                    return status(client, stateTracker);
                }

                @Override
                public Map<String, Object> reject(MinecraftClient client, ClientStateTracker stateTracker) {
                    requireResourcePackLoader(client).declineAll();
                    return status(client, stateTracker);
                }

                private ServerResourcePackLoader requireResourcePackLoader(MinecraftClient client) {
                    ServerResourcePackLoader loader = client.getServerResourcePackProvider();
                    if (loader == null) {
                        throw new ActionException("INVALID_STATE");
                    }
                    return loader;
                }
            },
            (client, parent, serverAddress, address) -> {
                ServerInfo serverInfo = new ServerInfo("MCT Auto Test", address, ServerInfo.ServerType.OTHER);
                ConnectScreen.connect(parent, client, serverAddress, serverInfo, false);
            }
        );
    }
}
