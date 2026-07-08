package com.mct.version;

import com.mct.core.state.ClientStateTracker;
import java.util.Map;
import net.minecraft.client.Minecraft;

public interface ResourcePackAdapter {

    Map<String, Object> status(Minecraft client, ClientStateTracker stateTracker);

    Map<String, Object> accept(Minecraft client, ClientStateTracker stateTracker);

    Map<String, Object> reject(Minecraft client, ClientStateTracker stateTracker);
}
