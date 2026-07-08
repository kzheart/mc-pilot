package com.mct.version;

import net.minecraft.client.player.LocalPlayer;

public interface NetworkAdapter {

    void sendLookPacket(LocalPlayer player, float yaw, float pitch);
}
