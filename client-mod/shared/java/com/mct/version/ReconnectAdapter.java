package com.mct.version;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.network.ServerAddress;

public interface ReconnectAdapter {

    void connect(MinecraftClient client, Screen parent, ServerAddress serverAddress, String address);
}
