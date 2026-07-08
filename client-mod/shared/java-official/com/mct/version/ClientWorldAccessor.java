package com.mct.version;

import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.player.LocalPlayer;

public interface ClientWorldAccessor {
    ClientLevel getClientWorld(LocalPlayer player);
}
