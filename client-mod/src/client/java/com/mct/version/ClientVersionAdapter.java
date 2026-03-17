package com.mct.version;

import com.mct.core.state.ClientStateTracker;
import java.util.Map;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.scoreboard.Scoreboard;
import net.minecraft.text.Text;

public interface ClientVersionAdapter {

    String toJsonString(Text text);

    Map<String, Object> scoreboardStatus(Scoreboard scoreboard);

    Map<String, Object> resourcePackStatus(MinecraftClient client, ClientStateTracker stateTracker);

    Map<String, Object> acceptResourcePack(MinecraftClient client, ClientStateTracker stateTracker);

    Map<String, Object> rejectResourcePack(MinecraftClient client, ClientStateTracker stateTracker);

    void connect(MinecraftClient client, Screen parent, ServerAddress serverAddress, String address);
}
