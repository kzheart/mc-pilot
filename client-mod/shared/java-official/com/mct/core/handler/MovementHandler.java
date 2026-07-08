package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.*;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.version.ClientVersionModulesHolder;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.phys.Vec3;

public final class MovementHandler extends ActionHandler {

    private static final double MOVE_STEP_SECONDS = 0.12D;
    private static final double MOVE_TO_TIMEOUT_SECONDS = 30.0D;

    private final InputHandler inputHandler;

    public MovementHandler(Minecraft client, ClientStateTracker stateTracker, InputHandler inputHandler) {
        super(client, stateTracker);
        this.inputHandler = inputHandler;
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
            case "look.set" -> runOnClientThread(() -> setRotation(requirePlayer(), (float) getDouble(params, "yaw"), (float) getDouble(params, "pitch")));
            case "look.at" -> runOnClientThread(() -> lookAt(requirePlayer(), getDouble(params, "x"), getDouble(params, "y"), getDouble(params, "z")));
            case "look.entity" -> runOnClientThread(() -> {
                LocalPlayer player = requirePlayer();
                Entity entity = findEntityByFilter(params);
                Map<String, Object> rotated = lookAt(player, entity.getX(), entity.getEyeY(), entity.getZ());
                LinkedHashMap<String, Object> result = new LinkedHashMap<>(rotated);
                result.put("entityId", entity.getId());
                return result;
            });
            case "move.jump" -> runOnClientThread(() -> {
                LocalPlayer player = requirePlayer();
                player.jumpFromGround();
                return com.mct.core.util.MctMaps.mapOf("success", true, "position", positionMap(player));
            });
            case "move.sneak" -> runOnClientThread(() -> {
                boolean enabled = getBoolean(params, "enabled", false);
                client.options.keyShift.setDown(enabled);
                return com.mct.core.util.MctMaps.mapOf("sneaking", enabled);
            });
            case "move.sprint" -> runOnClientThread(() -> {
                boolean enabled = getBoolean(params, "enabled", false);
                client.options.keySprint.setDown(enabled);
                LocalPlayer player = requirePlayer();
                player.setSprinting(enabled);
                return com.mct.core.util.MctMaps.mapOf("sprinting", enabled);
            });
            case "move.direction" -> moveDirection(params);
            case "move.to" -> moveTo(params);
            default -> throw new ActionException("INVALID_ACTION");
        };
    }

    public Map<String, Object> lookAt(LocalPlayer player, double x, double y, double z) {
        Vec3 eye = player.getEyePosition();
        double dx = x - eye.x;
        double dy = y - eye.y;
        double dz = z - eye.z;
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        float yaw = Mth.wrapDegrees((float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0D));
        float pitch = Mth.wrapDegrees((float) (-Math.toDegrees(Math.atan2(dy, horizontal))));
        return setRotation(player, yaw, pitch);
    }

    public Map<String, Object> setRotation(LocalPlayer player, float yaw, float pitch) {
        player.setYRot(yaw);
        player.setXRot(pitch);
        player.setYHeadRot(yaw);
        player.setYBodyRot(yaw);
        ClientVersionModulesHolder.get().network().sendLookPacket(player, yaw, pitch);
        return com.mct.core.util.MctMaps.mapOf("yaw", yaw, "pitch", pitch);
    }

    public Map<String, Object> moveTo(Map<String, Object> params) {
        double x = getDouble(params, "x");
        double y = getDouble(params, "y");
        double z = getDouble(params, "z");
        double timeoutSeconds = getDouble(params, "timeout", MOVE_TO_TIMEOUT_SECONDS);
        Instant startedAt = Instant.now();
        Vec3 target = new Vec3(x, y, z);
        double bestDistance = Double.MAX_VALUE;
        int stalledSteps = 0;
        boolean strafeLeft = true;

        while (Duration.between(startedAt, Instant.now()).toMillis() < (long) (timeoutSeconds * 1000.0D)) {
            Map<String, Object> status = runOnClientThread(() -> {
                LocalPlayer player = requirePlayer();
                Vec3 position = ClientVersionModulesHolder.get().compatibility().getPlayerPos(player);
                Vec3 delta = target.subtract(position);
                double horizontal = Math.sqrt(delta.x * delta.x + delta.z * delta.z);
                if (horizontal < 0.75D && Math.abs(delta.y) < 1.25D) {
                    LinkedHashMap<String, Object> result = new LinkedHashMap<>();
                    result.put("arrived", true);
                    result.put("finalPos", positionMap(player));
                    result.put("distance", position.distanceTo(target));
                    return result;
                }
                lookAt(player, target.x, target.y, target.z);
                if (delta.y > 0.6D && player.onGround()) {
                    player.jumpFromGround();
                }
                return com.mct.core.util.MctMaps.mapOf(
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
                return com.mct.core.util.MctMaps.mapOf(
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
            inputHandler.pressMovementKey(client.options.keyUp, (long) (MOVE_STEP_SECONDS * 1000.0D));
        }

        LocalPlayer player = runOnClientThread(this::requirePlayer);
        return com.mct.core.util.MctMaps.mapOf(
            "arrived", false,
            "finalPos", runOnClientThread(() -> positionMap(requirePlayer())),
            "distance", ClientVersionModulesHolder.get().compatibility().getPlayerPos(player).distanceTo(target)
        );
    }

    private Map<String, Object> moveDirection(Map<String, Object> params) {
        String direction = getString(params, "direction");
        double blocks = getDouble(params, "blocks");
        LocalPlayer player = requirePlayer();
        Vec3 start = ClientVersionModulesHolder.get().compatibility().getPlayerPos(player);
        long deadline = System.currentTimeMillis() + (long) (Math.max(1.5D, Math.abs(blocks) * 2.0D) * 1000.0D);
        while (System.currentTimeMillis() < deadline) {
            double moved = runOnClientThread(() -> ClientVersionModulesHolder.get().compatibility().getPlayerPos(requirePlayer()).distanceTo(start));
            if (moved >= Math.abs(blocks) - 0.15D) {
                break;
            }
            inputHandler.pressMovementKey(directionKey(direction), (long) (MOVE_STEP_SECONDS * 1000.0D));
        }
        return runOnClientThread(() -> com.mct.core.util.MctMaps.mapOf("newPos", positionMap(requirePlayer())));
    }

    private net.minecraft.client.KeyMapping directionKey(String direction) {
        return switch (direction) {
            case "forward" -> client.options.keyUp;
            case "back" -> client.options.keyDown;
            case "left" -> client.options.keyLeft;
            case "right" -> client.options.keyRight;
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
