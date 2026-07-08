package com.mct.core.network;

import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.Packet;

/** 1.20.1+ 的 Fabric/Forge 以及 NeoForge 1.20.x:yarn 方法名为 sendPacket。 */
public final class PacketSender {

    private PacketSender() {
    }

    public static void send(ClientPacketListener handler, Packet<?> packet) {
        handler.send(packet);
    }
}
