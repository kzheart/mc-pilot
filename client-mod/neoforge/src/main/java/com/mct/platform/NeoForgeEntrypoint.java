package com.mct.platform;

import com.mct.core.protocol.MctWebSocketServer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;

@Mod("mct")
public class NeoForgeEntrypoint {

    @EventBusSubscriber(modid = "mct", bus = EventBusSubscriber.Bus.MOD)
    public static class ModEvents {

        @SubscribeEvent
        public static void onClientSetup(FMLClientSetupEvent event) {
            MctWebSocketServer.startServer();
        }
    }
}
