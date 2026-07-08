package com.mct.version;

import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.phys.BlockHitResult;

public interface InteractionAdapter {

    InteractionResult interactItem(MultiPlayerGameMode manager, LocalPlayer player, InteractionHand hand);

    InteractionResult interactBlock(MultiPlayerGameMode manager, LocalPlayer player, InteractionHand hand, BlockHitResult hitResult);

    void sendCommand(LocalPlayer player, String command);

    void sendChatMessage(LocalPlayer player, String message);
}
