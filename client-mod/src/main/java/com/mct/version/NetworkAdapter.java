package com.mct.version;

import net.minecraft.client.network.ClientPlayerEntity;

public interface NetworkAdapter {

    void sendLookPacket(ClientPlayerEntity player, float yaw, float pitch);
}
