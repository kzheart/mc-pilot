package com.mct.version;

//? if >=1.20.3 {
import net.minecraft.text.Text;
import net.minecraft.scoreboard.ScoreboardEntry;
import net.minecraft.client.gui.screen.multiplayer.ConnectScreen;
import net.minecraft.client.resource.server.ServerResourcePackLoader;
//?} else {
/*import net.minecraft.text.Text;
import net.minecraft.scoreboard.ScoreboardPlayerScore;
import net.minecraft.client.gui.screen.ConnectScreen;*/
//?}

//? if >=1.20.2
import net.minecraft.scoreboard.ScoreboardDisplaySlot;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ClientActionExecutor.ActionException;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.scoreboard.Scoreboard;
import net.minecraft.scoreboard.ScoreboardObjective;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

public final class VersionAdapters {

    private VersionAdapters() {}

    public static ClientVersionModules create() {
        return new ClientVersionModules(
            createTextAdapter(),
            createScoreboardAdapter(),
            createResourcePackAdapter(),
            createReconnectAdapter()
        );
    }

    private static TextAdapter createTextAdapter() {
        //? if >=1.20.3
        return Text.Serialization::toJsonString;
        //? if <1.20.3
        /*return text -> Text.Serializer.toJson(text);*/
    }

    private static ScoreboardAdapter createScoreboardAdapter() {
        return scoreboard -> {
            //? if >=1.20.2 {
            ScoreboardObjective objective = scoreboard.getObjectiveForSlot(ScoreboardDisplaySlot.SIDEBAR);
            //?} else {
            /*ScoreboardObjective objective = scoreboard.getObjectiveForSlot(Scoreboard.SIDEBAR_DISPLAY_SLOT_ID);*/
            //?}

            if (objective == null) {
                return Map.of("title", "", "entries", List.of());
            }

            ArrayList<Map<String, Object>> entries = new ArrayList<>();
            //? if >=1.20.3 {
            scoreboard.getScoreboardEntries(objective).stream()
                .filter(entry -> !entry.hidden())
                .sorted(Comparator.comparingInt(ScoreboardEntry::value).reversed())
                .forEach(entry -> entries.add(
                    Map.of("name", entry.name().getString(), "score", entry.value())));
            //?} else {
            /*scoreboard.getAllPlayerScores(objective).stream()
                .sorted(Comparator.comparingInt(ScoreboardPlayerScore::getScore).reversed())
                .forEach(entry -> entries.add(
                    Map.of("name", entry.getPlayerName(), "score", entry.getScore())));*/
            //?}
            return Map.of("title", objective.getDisplayName().getString(), "entries", entries);
        };
    }

    private static ResourcePackAdapter createResourcePackAdapter() {
        //? if >=1.20.3 {
        return new ResourcePackAdapter() {
            @Override
            public Map<String, Object> status(MinecraftClient client, ClientStateTracker stateTracker) {
                requireLoader(client);
                return stateTracker.getResourcePackState();
            }

            @Override
            public Map<String, Object> accept(MinecraftClient client, ClientStateTracker stateTracker) {
                requireLoader(client).acceptAll();
                return status(client, stateTracker);
            }

            @Override
            public Map<String, Object> reject(MinecraftClient client, ClientStateTracker stateTracker) {
                requireLoader(client).declineAll();
                return status(client, stateTracker);
            }

            private ServerResourcePackLoader requireLoader(MinecraftClient client) {
                ServerResourcePackLoader loader = client.getServerResourcePackProvider();
                if (loader == null) {
                    throw new ActionException("INVALID_STATE");
                }
                return loader;
            }
        };
        //?} else {
        /*return new ResourcePackAdapter() {
            @Override
            public Map<String, Object> status(MinecraftClient client, ClientStateTracker stateTracker) {
                ServerInfo si = requireServerInfo(client);
                String s = switch (si.getResourcePackPolicy()) {
                    case ENABLED -> "enabled";
                    case DISABLED -> "disabled";
                    case PROMPT -> "prompt";
                };
                stateTracker.recordResourcePackState(s, 0);
                return stateTracker.getResourcePackState();
            }

            @Override
            public Map<String, Object> accept(MinecraftClient client, ClientStateTracker stateTracker) {
                requireServerInfo(client).setResourcePackPolicy(ServerInfo.ResourcePackPolicy.ENABLED);
                stateTracker.recordResourcePackState("enabled", 0);
                return stateTracker.getResourcePackState();
            }

            @Override
            public Map<String, Object> reject(MinecraftClient client, ClientStateTracker stateTracker) {
                requireServerInfo(client).setResourcePackPolicy(ServerInfo.ResourcePackPolicy.DISABLED);
                stateTracker.recordResourcePackState("disabled", 0);
                return stateTracker.getResourcePackState();
            }

            private ServerInfo requireServerInfo(MinecraftClient client) {
                ServerInfo si = client.getCurrentServerEntry();
                if (si == null) {
                    throw new ActionException("INVALID_STATE");
                }
                return si;
            }
        };*/
        //?}
    }

    private static ReconnectAdapter createReconnectAdapter() {
        return (client, parent, serverAddress, address) -> {
            //? if >=1.20.2 {
            ServerInfo serverInfo = new ServerInfo("MCT Auto Test", address, ServerInfo.ServerType.OTHER);
            //?} else {
            /*ServerInfo serverInfo = new ServerInfo("MCT Auto Test", address, false);*/
            //?}
            ConnectScreen.connect(parent, client, serverAddress, serverInfo, false);
        };
    }
}
