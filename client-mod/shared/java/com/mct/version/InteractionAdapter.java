package com.mct.version;

import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ClientPlayerInteractionManager;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import net.minecraft.util.hit.BlockHitResult;

public interface InteractionAdapter {

    ActionResult interactItem(ClientPlayerInteractionManager manager, ClientPlayerEntity player, Hand hand);

    ActionResult interactBlock(ClientPlayerInteractionManager manager, ClientPlayerEntity player, Hand hand, BlockHitResult hitResult);

    void sendCommand(ClientPlayerEntity player, String command);

    void sendChatMessage(ClientPlayerEntity player, String message);
}
