package com.mct.platform;

import com.mct.core.protocol.MctWebSocketServer;
import com.mct.version.ClientVersionModulesHolder;
import com.mct.version.impl.VersionAdaptersImpl;
import net.fabricmc.api.ClientModInitializer;

public class FabricEntrypoint implements ClientModInitializer {

    @Override
    public void onInitializeClient() {
        ClientVersionModulesHolder.init(VersionAdaptersImpl.create());
        MctWebSocketServer.startServer();
    }
}
