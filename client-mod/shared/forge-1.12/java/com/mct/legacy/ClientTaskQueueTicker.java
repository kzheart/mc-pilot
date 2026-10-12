package com.mct.legacy;

import com.mct.core.concurrent.ClientTaskQueue;
import net.minecraftforge.fml.common.eventhandler.SubscribeEvent;
import net.minecraftforge.fml.common.gameevent.TickEvent;

/** Thin legacy entrypoint for the same command queue used by modern clients. */
public final class ClientTaskQueueTicker {
    @SubscribeEvent
    public void onClientTick(TickEvent.ClientTickEvent event) {
        if (event.phase == TickEvent.Phase.END) {
            ClientTaskQueue.getInstance().drain();
        }
    }
}
