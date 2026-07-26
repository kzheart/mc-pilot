package com.mct.legacy;

import com.google.gson.JsonObject;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.block.Block;
import net.minecraft.block.properties.IProperty;
import net.minecraft.block.state.IBlockState;
import net.minecraft.client.entity.EntityPlayerSP;
import net.minecraft.util.EnumActionResult;
import net.minecraft.util.EnumFacing;
import net.minecraft.util.EnumHand;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;

/** block.get / block.interact / block.place / block.break */
public final class WorldActions extends LegacyActions {

    @Override
    public Map<String, Object> handle(String action, JsonObject params) {
        if ("block.get".equals(action)) {
            return onClient(() -> getBlock(params));
        }
        if ("block.interact".equals(action)) {
            return onClient(() -> interactBlock(blockPos(params), null));
        }
        if ("block.place".equals(action)) {
            return placeBlock(params);
        }
        if ("block.break".equals(action)) {
            return breakBlock(params);
        }
        throw new LegacyActionException("INVALID_ACTION");
    }

    private Map<String, Object> getBlock(JsonObject params) {
        requirePlayer();
        BlockPos pos = blockPos(params);
        IBlockState state = client.world.getBlockState(pos);
        Map<String, Object> properties = new LinkedHashMap<String, Object>();
        for (IProperty<?> property : state.getPropertyKeys()) {
            properties.put(property.getName(), String.valueOf(state.getValue(property)));
        }
        return map(
            "type", blockId(state),
            "properties", properties,
            "lightLevel", client.world.getLight(pos)
        );
    }

    private Map<String, Object> interactBlock(BlockPos pos, EnumFacing forcedFace) {
        EntityPlayerSP player = requirePlayer();
        EnumFacing face = forcedFace != null ? forcedFace : inferHitSide(player, pos);
        Vec3d hit = new Vec3d(pos.getX() + 0.5D, pos.getY() + 0.5D, pos.getZ() + 0.5D);
        EnumActionResult result = requireController().processRightClickBlock(
            player, client.world, pos, face, hit, EnumHand.MAIN_HAND
        );
        boolean accepted = result == EnumActionResult.SUCCESS;
        return map("success", accepted, "resultAction", result.name());
    }

    private Map<String, Object> placeBlock(JsonObject params) {
        BlockPos target = onClient(() -> blockPos(params));
        String faceName = Params.requireString(params, "face");
        EnumFacing face = EnumFacing.byName(faceName);
        if (face == null) {
            throw new LegacyActionException("INVALID_PARAMS");
        }
        Map<String, Object> interaction = onClient(() -> {
            BlockPos support = target.offset(face.getOpposite());
            return interactBlock(support, face);
        });
        long startedAt = System.currentTimeMillis();
        while (elapsedSeconds(startedAt) < 2.0D) {
            String placedType = onClient(() -> blockId(client.world.getBlockState(target)));
            if (!"minecraft:air".equals(placedType)) {
                return map("success", Boolean.TRUE.equals(interaction.get("success")), "placedType", placedType);
            }
            MainThread.sleep(50L);
        }
        return map(
            "success", false,
            "placedType", onClient(() -> blockId(client.world.getBlockState(target)))
        );
    }

    private Map<String, Object> breakBlock(JsonObject params) {
        BlockPos pos = onClient(() -> blockPos(params));
        EnumFacing side = onClient(() -> inferHitSide(requirePlayer(), pos));
        long startedAt = System.currentTimeMillis();
        onClient(() -> {
            requirePlayer();
            requireController().clickBlock(pos, side);
            return true;
        });
        while (elapsedSeconds(startedAt) < 15.0D) {
            boolean done = onClient(() -> {
                requirePlayer();
                return client.world.isAirBlock(pos);
            });
            if (done) {
                return map(
                    "success", true,
                    "blockType", "minecraft:air",
                    "duration", System.currentTimeMillis() - startedAt
                );
            }
            onClient(() -> {
                requireController().onPlayerDamageBlock(pos, side);
                return true;
            });
            MainThread.sleep(100L);
        }
        onClient(() -> {
            requireController().resetBlockRemoving();
            return true;
        });
        return map(
            "success", false,
            "blockType", onClient(() -> blockId(client.world.getBlockState(pos))),
            "duration", System.currentTimeMillis() - startedAt
        );
    }

    private String blockId(IBlockState state) {
        return String.valueOf(Block.REGISTRY.getNameForObject(state.getBlock()));
    }

    static EnumFacing inferHitSide(EntityPlayerSP player, BlockPos pos) {
        double eyeY = player.posY + player.getEyeHeight();
        double dx = pos.getX() + 0.5D - player.posX;
        double dy = pos.getY() + 0.5D - eyeY;
        double dz = pos.getZ() + 0.5D - player.posZ;
        return EnumFacing.getFacingFromVector((float) dx, (float) dy, (float) dz);
    }
}
