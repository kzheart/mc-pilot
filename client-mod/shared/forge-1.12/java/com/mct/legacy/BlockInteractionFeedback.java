package com.mct.legacy;

import net.minecraft.client.Minecraft;
import net.minecraft.client.entity.EntityPlayerSP;
import net.minecraft.client.multiplayer.PlayerControllerMP;
import net.minecraft.item.ItemStack;
import net.minecraft.util.EnumActionResult;
import net.minecraft.util.EnumFacing;
import net.minecraft.util.EnumHand;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;

/** The client-side feedback normally supplied by Minecraft.rightClickMouse. */
final class BlockInteractionFeedback {
    private BlockInteractionFeedback() {}

    static EnumActionResult interact(Minecraft client, PlayerControllerMP controller, EntityPlayerSP player,
                                     BlockPos pos, EnumFacing face, Vec3d hit, EnumHand hand) {
        ItemStack stack = player.getHeldItem(hand);
        int countBefore = stack.getCount();
        EnumActionResult result = controller.processRightClickBlock(player, client.world, pos, face, hit, hand);
        if (result == EnumActionResult.SUCCESS) {
            player.swingArm(hand);
            if (!stack.isEmpty() && (stack.getCount() != countBefore || controller.isInCreativeMode())) {
                client.getItemRenderer().resetEquippedProgress(hand);
            }
        }
        return result;
    }
}
