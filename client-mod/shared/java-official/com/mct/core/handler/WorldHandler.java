package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.getString;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.version.ClientVersionModulesHolder;
import com.mct.version.McRegistries;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

public final class WorldHandler extends ActionHandler {

    public WorldHandler(Minecraft client, ClientStateTracker stateTracker) {
        super(client, stateTracker);
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
            case "block.get" -> runOnClientThread(() -> getBlock(params));
            case "block.interact" -> runOnClientThread(() -> interactBlock(params));
            case "block.place" -> runOnClientThread(() -> placeBlock(params));
            case "block.break" -> breakBlock(params);
            default -> throw new ActionException("INVALID_ACTION");
        };
    }

    private Map<String, Object> getBlock(Map<String, Object> params) {
        BlockPos pos = blockPos(params);
        ClientLevel world = clientWorld(requirePlayer());
        BlockState state = world.getBlockState(pos);
        LinkedHashMap<String, Object> properties = new LinkedHashMap<>();
        state.getValues().forEach(pv -> properties.put(pv.property().getName(), String.valueOf(pv.value())));
        return com.mct.core.util.MctMaps.mapOf(
            "type", String.valueOf(McRegistries.blockId(state.getBlock())),
            "properties", properties,
            "lightLevel", world.getMaxLocalRawBrightness(pos)
        );
    }

    private Map<String, Object> interactBlock(Map<String, Object> params) {
        LocalPlayer player = requirePlayer();
        BlockPos pos = blockPos(params);
        Direction face = inferHitSide(pos);
        InteractionResult result = ClientVersionModulesHolder.get().interaction().interactBlock(
            requireInteractionManager(), player, InteractionHand.MAIN_HAND,
            new BlockHitResult(Vec3.atCenterOf(pos), face, pos, false)
        );
        return com.mct.core.util.MctMaps.mapOf("success", result.consumesAction(), "resultAction", ClientVersionModulesHolder.get().actionResult().resultName(result));
    }

    private Map<String, Object> placeBlock(Map<String, Object> params) {
        LocalPlayer player = requirePlayer();
        BlockPos target = blockPos(params);
        Direction face = ClientVersionModulesHolder.get().compatibility().directionByName(getString(params, "face"));
        if (face == null) {
            throw new ActionException("INVALID_PARAMS");
        }
        BlockPos support = target.relative(face.getOpposite());
        BlockHitResult hit = new BlockHitResult(Vec3.atCenterOf(support), face, support, false);
        InteractionResult result = ClientVersionModulesHolder.get().interaction().interactBlock(requireInteractionManager(), player, InteractionHand.MAIN_HAND, hit);
        Instant startedAt = Instant.now();
        while (Duration.between(startedAt, Instant.now()).toMillis() < 2_000L) {
            String placedType = String.valueOf(McRegistries.blockId(clientWorld(requirePlayer()).getBlockState(target).getBlock()));
            if (!"minecraft:air".equals(placedType)) {
                return com.mct.core.util.MctMaps.mapOf("success", result.consumesAction(), "placedType", placedType);
            }
            safeSleep(50L);
        }
        return com.mct.core.util.MctMaps.mapOf(
            "success", false,
            "placedType", String.valueOf(McRegistries.blockId(clientWorld(requirePlayer()).getBlockState(target).getBlock()))
        );
    }

    private Map<String, Object> breakBlock(Map<String, Object> params) {
        BlockPos pos = runOnClientThread(() -> blockPos(params));
        Direction side = runOnClientThread(() -> inferHitSide(pos));
        Instant startedAt = Instant.now();
        runOnClientThread(() -> requireInteractionManager().startDestroyBlock(pos, side));
        while (Duration.between(startedAt, Instant.now()).toMillis() < 15_000L) {
            boolean done = runOnClientThread(() -> clientWorld(requirePlayer()).getBlockState(pos).isAir());
            if (done) {
                return runOnClientThread(() -> com.mct.core.util.MctMaps.mapOf(
                    "success", true,
                    "blockType", "minecraft:air",
                    "duration", Duration.between(startedAt, Instant.now()).toMillis()
                ));
            }
            runOnClientThread(() -> {
                requireInteractionManager().continueDestroyBlock(pos, side);
                return true;
            });
            safeSleep(100L);
        }
        runOnClientThread(() -> {
            requireInteractionManager().stopDestroyBlock();
            return true;
        });
        return com.mct.core.util.MctMaps.mapOf(
            "success", false,
            "blockType", runOnClientThread(() -> String.valueOf(McRegistries.blockId(clientWorld(requirePlayer()).getBlockState(pos).getBlock()))),
            "duration", Duration.between(startedAt, Instant.now()).toMillis()
        );
    }

    private Direction inferHitSide(BlockPos pos) {
        Vec3 eye = requirePlayer().getEyePosition();
        Vec3 delta = Vec3.atCenterOf(pos).subtract(eye);
        return Direction.getApproximateNearest(delta.x, delta.y, delta.z);
    }
}
