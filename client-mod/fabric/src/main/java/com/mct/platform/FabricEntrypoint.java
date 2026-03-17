package com.mct.platform;

import com.mct.core.protocol.MctWebSocketServer;
import net.fabricmc.api.ClientModInitializer;

public class FabricEntrypoint implements ClientModInitializer {

    @Override
    public void onInitializeClient() {
        MctWebSocketServer.startServer();
    }
}
