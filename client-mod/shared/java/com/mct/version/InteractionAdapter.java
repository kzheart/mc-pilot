package com.mct.version;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ClientPlayerInteractionManager;
import net.minecraft.item.ItemStack;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import net.minecraft.util.hit.BlockHitResult;

public interface InteractionAdapter {

    ActionResult interactItem(ClientPlayerInteractionManager manager, ClientPlayerEntity player, Hand hand);

    ActionResult interactBlock(ClientPlayerInteractionManager manager, ClientPlayerEntity player, Hand hand, BlockHitResult hitResult);

    /** Whether vanilla requests a client-side swing for this block-use result. */
    boolean shouldSwingAfterBlockUse(ActionResult result);

    /** Vanilla's version-specific infinite-materials check for held-item feedback. */
    boolean hasUnlimitedBlockItems(ClientPlayerInteractionManager manager, ClientPlayerEntity player);

    /**
     * Complete the block-use branch of MinecraftClient.doItemUse on the client thread.
     * The interaction manager performs the action but does not play this feedback.
     * Keep the original stack reference: vanilla checks its post-interaction count.
     */
    default ActionResult interactBlockWithFeedback(MinecraftClient client, ClientPlayerInteractionManager manager,
                                                  ClientPlayerEntity player, Hand hand, BlockHitResult hitResult) {
        ItemStack stack = player.getStackInHand(hand);
        int countBefore = stack.getCount();
        ActionResult result = interactBlock(manager, player, hand, hitResult);
        if (shouldSwingAfterBlockUse(result)) {
            player.swingHand(hand);
            if (!stack.isEmpty() && (stack.getCount() != countBefore || hasUnlimitedBlockItems(manager, player))) {
                client.gameRenderer.firstPersonRenderer.resetEquipProgress(hand);
            }
        }
        return result;
    }

    void sendCommand(ClientPlayerEntity player, String command);

    void sendChatMessage(ClientPlayerEntity player, String message);
}
