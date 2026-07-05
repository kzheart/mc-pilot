package com.mct.core.network;

import net.minecraft.client.network.ClientPlayNetworkHandler;
import net.minecraft.network.Packet;

/** 1.18.2 及更早版本:Packet 位于 net.minecraft.network,方法名为 sendPacket。 */
public final class PacketSender {

    private PacketSender() {
    }

    public static void send(ClientPlayNetworkHandler handler, Packet<?> packet) {
        handler.sendPacket(packet);
    }
}
