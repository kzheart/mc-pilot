package com.mct.version.v1202;

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
import net.minecraft.client.gui.screen.ConnectScreen;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.scoreboard.Scoreboard;
import net.minecraft.scoreboard.ScoreboardDisplaySlot;
import net.minecraft.scoreboard.ScoreboardObjective;
import net.minecraft.scoreboard.ScoreboardPlayerScore;
import net.minecraft.text.Text;

public final class Fabric1202ClientVersionModulesProvider implements ClientVersionModulesProvider {

    @Override
    public ClientVersionModules create() {
        return new ClientVersionModules(
            text -> Text.Serializer.toJson(text),
            scoreboard -> {
                ScoreboardObjective objective = scoreboard.getObjectiveForSlot(ScoreboardDisplaySlot.SIDEBAR);
                if (objective == null) {
                    return Map.of("title", "", "entries", List.of());
                }

                ArrayList<Map<String, Object>> entries = new ArrayList<>();
                scoreboard.getAllPlayerScores(objective).stream()
                    .sorted(Comparator.comparingInt(ScoreboardPlayerScore::getScore).reversed())
                    .forEach(entry -> entries.add(Map.of("name", entry.getPlayerName(), "score", entry.getScore())));
                return Map.of("title", objective.getDisplayName().getString(), "entries", entries);
            },
            new ResourcePackAdapter() {
                @Override
                public Map<String, Object> status(MinecraftClient client, ClientStateTracker stateTracker) {
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
                public Map<String, Object> accept(MinecraftClient client, ClientStateTracker stateTracker) {
                    ServerInfo serverInfo = requireServerInfo(client);
                    serverInfo.setResourcePackPolicy(ServerInfo.ResourcePackPolicy.ENABLED);
                    stateTracker.recordResourcePackState("enabled", 0);
                    return stateTracker.getResourcePackState();
                }

                @Override
                public Map<String, Object> reject(MinecraftClient client, ClientStateTracker stateTracker) {
                    ServerInfo serverInfo = requireServerInfo(client);
                    serverInfo.setResourcePackPolicy(ServerInfo.ResourcePackPolicy.DISABLED);
                    stateTracker.recordResourcePackState("disabled", 0);
                    return stateTracker.getResourcePackState();
                }

                private ServerInfo requireServerInfo(MinecraftClient client) {
                    ServerInfo serverInfo = client.getCurrentServerEntry();
                    if (serverInfo == null) {
                        throw new ActionException("INVALID_STATE");
                    }
                    return serverInfo;
                }
            },
            (client, parent, serverAddress, address) -> {
                ServerInfo serverInfo = new ServerInfo("MCT Auto Test", address, ServerInfo.ServerType.OTHER);
                ConnectScreen.connect(parent, client, serverAddress, serverInfo, false);
            }
        );
    }
}
