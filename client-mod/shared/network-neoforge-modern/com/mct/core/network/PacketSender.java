package com.mct.core.network;

import net.minecraft.client.network.ClientPlayNetworkHandler;
import net.minecraft.network.packet.Packet;

/** NeoForge 1.21.x:NeoForge 补丁替换了原版方法,yarn-mappings-patch-neoforge 将其映射为 send。 */
public final class PacketSender {

    private PacketSender() {
    }

    public static void send(ClientPlayNetworkHandler handler, Packet<?> packet) {
        handler.send(packet);
    }
}
