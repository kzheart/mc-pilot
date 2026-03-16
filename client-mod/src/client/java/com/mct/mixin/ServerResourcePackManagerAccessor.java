package com.mct.mixin;

import java.util.List;
import net.minecraft.client.resource.server.ServerResourcePackManager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

@Mixin(ServerResourcePackManager.class)
public interface ServerResourcePackManagerAccessor {

    @Accessor("acceptanceStatus")
    ServerResourcePackManager.AcceptanceStatus mct$getAcceptanceStatus();

    @Accessor("packs")
    List<?> mct$getPacks();
}
