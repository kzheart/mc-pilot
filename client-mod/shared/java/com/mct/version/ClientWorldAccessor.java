package com.mct.version;

import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.world.ClientWorld;

public interface ClientWorldAccessor {
    ClientWorld getClientWorld(ClientPlayerEntity player);
}
