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
import net.minecraft.block.BlockState;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.Vec3d;

public final class WorldHandler extends ActionHandler {

    public WorldHandler(MinecraftClient client, ClientStateTracker stateTracker) {
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
        ClientWorld world = clientWorld(requirePlayer());
        BlockState state = world.getBlockState(pos);
        LinkedHashMap<String, Object> properties = new LinkedHashMap<>();
        state.getEntries().forEach((property, value) -> properties.put(property.getName(), String.valueOf(value)));
        return com.mct.core.util.MctMaps.mapOf(
            "type", String.valueOf(McRegistries.blockId(state.getBlock())),
            "properties", properties,
            "lightLevel", world.getLightLevel(pos)
        );
    }

    private Map<String, Object> interactBlock(Map<String, Object> params) {
        ClientPlayerEntity player = requirePlayer();
        BlockPos pos = blockPos(params);
        Direction face = inferHitSide(pos);
        ActionResult result = ClientVersionModulesHolder.get().interaction().interactBlock(
            requireInteractionManager(), player, Hand.MAIN_HAND,
            new BlockHitResult(Vec3d.ofCenter(pos), face, pos, false)
        );
        return com.mct.core.util.MctMaps.mapOf("success", result.isAccepted(), "resultAction", ClientVersionModulesHolder.get().actionResult().resultName(result));
    }

    private Map<String, Object> placeBlock(Map<String, Object> params) {
        ClientPlayerEntity player = requirePlayer();
        BlockPos target = blockPos(params);
        Direction face = ClientVersionModulesHolder.get().compatibility().directionByName(getString(params, "face"));
        if (face == null) {
            throw new ActionException("INVALID_PARAMS");
        }
        BlockPos support = target.offset(face.getOpposite());
        BlockHitResult hit = new BlockHitResult(Vec3d.ofCenter(support), face, support, false);
        ActionResult result = ClientVersionModulesHolder.get().interaction().interactBlock(requireInteractionManager(), player, Hand.MAIN_HAND, hit);
        Instant startedAt = Instant.now();
        while (Duration.between(startedAt, Instant.now()).toMillis() < 2_000L) {
            String placedType = String.valueOf(McRegistries.blockId(clientWorld(requirePlayer()).getBlockState(target).getBlock()));
            if (!"minecraft:air".equals(placedType)) {
                return com.mct.core.util.MctMaps.mapOf("success", result.isAccepted(), "placedType", placedType);
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
        runOnClientThread(() -> requireInteractionManager().attackBlock(pos, side));
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
                requireInteractionManager().updateBlockBreakingProgress(pos, side);
                return true;
            });
            safeSleep(100L);
        }
        runOnClientThread(() -> {
            requireInteractionManager().cancelBlockBreaking();
            return true;
        });
        return com.mct.core.util.MctMaps.mapOf(
            "success", false,
            "blockType", runOnClientThread(() -> String.valueOf(McRegistries.blockId(clientWorld(requirePlayer()).getBlockState(pos).getBlock()))),
            "duration", Duration.between(startedAt, Instant.now()).toMillis()
        );
    }

    private Direction inferHitSide(BlockPos pos) {
        Vec3d eye = requirePlayer().getEyePos();
        Vec3d delta = Vec3d.ofCenter(pos).subtract(eye);
        return Direction.getFacing(delta.x, delta.y, delta.z);
    }
}
