package com.mct.core.resourcepack;

import java.util.List;
import net.minecraft.client.network.ServerInfo;

/** Implemented by the modern saved-server list Mixin, absent on older game versions. */
public interface HiddenServerEntries {
    List<ServerInfo> mct$getHiddenServers();
}
