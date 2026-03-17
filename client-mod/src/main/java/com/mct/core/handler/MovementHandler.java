package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.*;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.version.ClientVersionModulesHolder;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.entity.Entity;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.math.Vec3d;

public final class MovementHandler extends ActionHandler {

    private static final double MOVE_STEP_SECONDS = 0.12D;
    private static final double MOVE_TO_TIMEOUT_SECONDS = 30.0D;

    private final InputHandler inputHandler;

    public MovementHandler(MinecraftClient client, ClientStateTracker stateTracker, InputHandler inputHandler) {
        super(client, stateTracker);
        this.inputHandler = inputHandler;
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
            case "look.set" -> runOnClientThread(() -> setRotation(requirePlayer(), (float) getDouble(params, "yaw"), (float) getDouble(params, "pitch")));
            case "look.at" -> runOnClientThread(() -> lookAt(requirePlayer(), getDouble(params, "x"), getDouble(params, "y"), getDouble(params, "z")));
            case "look.entity" -> runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                Entity entity = findEntityByFilter(params);
                Map<String, Object> rotated = lookAt(player, entity.getX(), entity.getEyeY(), entity.getZ());
                LinkedHashMap<String, Object> result = new LinkedHashMap<>(rotated);
                result.put("entityId", entity.getId());
                return result;
            });
            case "move.jump" -> runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                player.jump();
                return Map.of("success", true, "position", positionMap(player));
            });
            case "move.sneak" -> runOnClientThread(() -> {
                boolean enabled = getBoolean(params, "enabled", false);
                client.options.sneakKey.setPressed(enabled);
                return Map.of("sneaking", enabled);
            });
            case "move.sprint" -> runOnClientThread(() -> {
                boolean enabled = getBoolean(params, "enabled", false);
                client.options.sprintKey.setPressed(enabled);
                ClientPlayerEntity player = requirePlayer();
                player.setSprinting(enabled);
                return Map.of("sprinting", enabled);
            });
            case "move.direction" -> moveDirection(params);
            case "move.to" -> moveTo(params);
            default -> throw new ActionException("INVALID_ACTION");
        };
    }

    public Map<String, Object> lookAt(ClientPlayerEntity player, double x, double y, double z) {
        Vec3d eye = player.getEyePos();
        double dx = x - eye.x;
        double dy = y - eye.y;
        double dz = z - eye.z;
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        float yaw = MathHelper.wrapDegrees((float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0D));
        float pitch = MathHelper.wrapDegrees((float) (-Math.toDegrees(Math.atan2(dy, horizontal))));
        return setRotation(player, yaw, pitch);
    }

    public Map<String, Object> setRotation(ClientPlayerEntity player, float yaw, float pitch) {
        player.setYaw(yaw);
        player.setPitch(pitch);
        player.setHeadYaw(yaw);
        player.setBodyYaw(yaw);
        ClientVersionModulesHolder.get().network().sendLookPacket(player, yaw, pitch);
        return Map.of("yaw", yaw, "pitch", pitch);
    }

    public Map<String, Object> moveTo(Map<String, Object> params) {
        double x = getDouble(params, "x");
        double y = getDouble(params, "y");
        double z = getDouble(params, "z");
        double timeoutSeconds = getDouble(params, "timeout", MOVE_TO_TIMEOUT_SECONDS);
        Instant startedAt = Instant.now();
        Vec3d target = new Vec3d(x, y, z);
        double bestDistance = Double.MAX_VALUE;
        int stalledSteps = 0;
        boolean strafeLeft = true;

        while (Duration.between(startedAt, Instant.now()).toMillis() < (long) (timeoutSeconds * 1000.0D)) {
            Map<String, Object> status = runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                Vec3d position = player.getPos();
                Vec3d delta = target.subtract(position);
                double horizontal = Math.sqrt(delta.x * delta.x + delta.z * delta.z);
                if (horizontal < 0.75D && Math.abs(delta.y) < 1.25D) {
                    LinkedHashMap<String, Object> result = new LinkedHashMap<>();
                    result.put("arrived", true);
                    result.put("finalPos", positionMap(player));
                    result.put("distance", position.distanceTo(target));
                    return result;
                }
                lookAt(player, target.x, target.y, target.z);
                if (delta.y > 0.6D && player.isOnGround()) {
                    player.jump();
                }
                return Map.of(
                    "arrived", false,
                    "distance", position.distanceTo(target),
                    "horizontal", horizontal,
                    "vertical", Math.abs(delta.y)
                );
            });
            if (Boolean.TRUE.equals(status.get("arrived"))) {
                return status;
            }
            double currentDistance = asDouble(status.get("distance"));
            double currentHorizontal = asDouble(status.get("horizontal"));
            double currentVertical = asDouble(status.get("vertical"));
            if (currentDistance + 0.05D < bestDistance) {
                bestDistance = currentDistance;
                stalledSteps = 0;
            } else {
                stalledSteps++;
            }
            if (stalledSteps >= 4 && currentHorizontal < 2.75D && currentVertical < 1.5D) {
                return Map.of(
                    "arrived", true,
                    "finalPos", runOnClientThread(() -> positionMap(requirePlayer())),
                    "distance", currentDistance
                );
            }
            if (stalledSteps >= 4) {
                inputHandler.pressMovementKeys(true, false, strafeLeft, !strafeLeft, true, false, 250L);
                strafeLeft = !strafeLeft;
                stalledSteps = 0;
                continue;
            }
            inputHandler.pressMovementKey(client.options.forwardKey, (long) (MOVE_STEP_SECONDS * 1000.0D));
        }

        ClientPlayerEntity player = runOnClientThread(this::requirePlayer);
        return Map.of(
            "arrived", false,
            "finalPos", runOnClientThread(() -> positionMap(requirePlayer())),
            "distance", player.getPos().distanceTo(target)
        );
    }

    private Map<String, Object> moveDirection(Map<String, Object> params) {
        String direction = getString(params, "direction");
        double blocks = getDouble(params, "blocks");
        ClientPlayerEntity player = requirePlayer();
        Vec3d start = player.getPos();
        long deadline = System.currentTimeMillis() + (long) (Math.max(1.5D, Math.abs(blocks) * 2.0D) * 1000.0D);
        while (System.currentTimeMillis() < deadline) {
            double moved = runOnClientThread(() -> requirePlayer().getPos().distanceTo(start));
            if (moved >= Math.abs(blocks) - 0.15D) {
                break;
            }
            inputHandler.pressMovementKey(directionKey(direction), (long) (MOVE_STEP_SECONDS * 1000.0D));
        }
        return runOnClientThread(() -> Map.of("newPos", positionMap(requirePlayer())));
    }

    private net.minecraft.client.option.KeyBinding directionKey(String direction) {
        return switch (direction) {
            case "forward" -> client.options.forwardKey;
            case "back" -> client.options.backKey;
            case "left" -> client.options.leftKey;
            case "right" -> client.options.rightKey;
            default -> throw new ActionException("INVALID_PARAMS");
        };
    }

    private Entity findEntityByFilter(Map<String, Object> params) {
        Object filter = getRequired(params, "filter");
        if (!(filter instanceof Map<?, ?> rawFilter)) {
            throw new ActionException("INVALID_PARAMS");
        }
        LinkedHashMap<String, Object> filterMap = new LinkedHashMap<>();
        rawFilter.forEach((key, value) -> filterMap.put(String.valueOf(key), value));
        return EntityHelper.findEntity(requirePlayer(), filterMap);
    }
}
