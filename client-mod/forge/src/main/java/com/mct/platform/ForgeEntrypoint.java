package com.mct.platform;

import com.mct.core.protocol.MctWebSocketServer;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;

@Mod("mct")
public class ForgeEntrypoint {

    public ForgeEntrypoint() {
        FMLJavaModLoadingContext.get().getModEventBus()
            .addListener(this::onClientSetup);
    }

    private void onClientSetup(FMLClientSetupEvent event) {
        MctWebSocketServer.startServer();
    }
}
