package com.mct.client;

import com.mct.core.protocol.MctWebSocketServer;
import net.fabricmc.api.ClientModInitializer;
import net.minecraft.client.MinecraftClient;

public final class MctClientMod implements ClientModInitializer {

    private static MctWebSocketServer server;

    @Override
    public void onInitializeClient() {
        int port = Integer.parseInt(System.getenv().getOrDefault("MCT_CLIENT_WS_PORT", "25560"));
        MinecraftClient client = MinecraftClient.getInstance();
        server = new MctWebSocketServer(port, client);
        server.start();
    }

    public static MctWebSocketServer getServer() {
        return server;
    }
}
