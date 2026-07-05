package com.mct.platform;

import com.mct.core.protocol.MctWebSocketServer;
import com.mct.version.ClientVersionModulesHolder;
import com.mct.version.impl.VersionAdaptersImpl;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;

@Mod(NeoForgeEntrypoint.MOD_ID)
public final class NeoForgeEntrypoint {
    public static final String MOD_ID = "mct";

    private static boolean initialized;

    public NeoForgeEntrypoint(IEventBus modEventBus) {
        modEventBus.addListener(this::onClientSetup);
    }

    private void onClientSetup(FMLClientSetupEvent event) {
        event.enqueueWork(() -> {
            if (initialized) {
                return;
            }
            initialized = true;
            ClientVersionModulesHolder.init(VersionAdaptersImpl.create());
            MctWebSocketServer.startServer();
        });
    }
}
