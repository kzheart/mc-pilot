package com.mct.version;

import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.world.item.ItemStack;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.phys.BlockHitResult;

public interface InteractionAdapter {

    InteractionResult interactItem(MultiPlayerGameMode manager, LocalPlayer player, InteractionHand hand);

    InteractionResult interactBlock(MultiPlayerGameMode manager, LocalPlayer player, InteractionHand hand, BlockHitResult hitResult);

    /**
     * Complete vanilla's client-side block-use feedback, once, on the client thread.
     * Server-driven or non-swinging successes must not start a second local swing.
     */
    default InteractionResult interactBlockWithFeedback(Minecraft client, MultiPlayerGameMode manager,
                                                       LocalPlayer player, InteractionHand hand, BlockHitResult hitResult) {
        ItemStack stack = player.getItemInHand(hand);
        int countBefore = stack.getCount();
        InteractionResult result = interactBlock(manager, player, hand, hitResult);
        if (result instanceof InteractionResult.Success success
                && success.swingSource() == InteractionResult.SwingSource.CLIENT) {
            player.swing(hand);
            if (!stack.isEmpty() && (stack.getCount() != countBefore || player.hasInfiniteMaterials())) {
                client.gameRenderer.itemInHandRenderer.itemUsed(hand);
            }
        }
        return result;
    }

    void sendCommand(LocalPlayer player, String command);

    void sendChatMessage(LocalPlayer player, String message);
}
