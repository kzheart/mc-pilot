package com.mct.version;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.resolver.ServerAddress;

public interface ReconnectAdapter {

    void connect(Minecraft client, Screen parent, ServerAddress serverAddress, String address);
}
