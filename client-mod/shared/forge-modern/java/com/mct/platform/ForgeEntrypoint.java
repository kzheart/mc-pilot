package com.mct.platform;

import com.mct.core.protocol.MctWebSocketServer;
import com.mct.version.ClientVersionModulesHolder;
import com.mct.version.impl.VersionAdaptersImpl;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;

/** Forge 61+ (EventBus 7) entrypoint: mod event bus replaced by BusGroup. */
@Mod(ForgeEntrypoint.MOD_ID)
public final class ForgeEntrypoint {
    public static final String MOD_ID = "mct";

    private static boolean initialized;

    public ForgeEntrypoint(FMLJavaModLoadingContext context) {
        FMLClientSetupEvent.getBus(context.getModBusGroup()).addListener(this::onClientSetup);
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
