package com.mct.version;

import com.mct.core.state.ClientStateTracker;
import java.util.Map;
import net.minecraft.client.MinecraftClient;

public interface ResourcePackAdapter {

    Map<String, Object> status(MinecraftClient client, ClientStateTracker stateTracker);

    Map<String, Object> accept(MinecraftClient client, ClientStateTracker stateTracker);

    Map<String, Object> reject(MinecraftClient client, ClientStateTracker stateTracker);
}
