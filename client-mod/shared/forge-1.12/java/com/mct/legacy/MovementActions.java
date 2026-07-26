package com.mct.legacy;

import com.google.gson.JsonObject;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.entity.EntityPlayerSP;
import net.minecraft.client.settings.KeyBinding;
import net.minecraft.entity.Entity;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.math.Vec3d;

/** look.* / move.* — polling-based movement mirroring the modern MovementHandler. */
public final class MovementActions extends LegacyActions {

    private static final double MOVE_STEP_SECONDS = 0.12D;
    private static final double MOVE_TO_TIMEOUT_SECONDS = 30.0D;

    @Override
    public Map<String, Object> handle(String action, JsonObject params) {
        if ("look.set".equals(action)) {
            return onClient(() -> setRotation(
                requirePlayer(),
                (float) Params.requireDouble(params, "yaw"),
                (float) Params.requireDouble(params, "pitch")
            ));
        }
        if ("look.at".equals(action)) {
            return onClient(() -> lookAt(
                requirePlayer(),
                Params.requireDouble(params, "x"),
                Params.requireDouble(params, "y"),
                Params.requireDouble(params, "z")
            ));
        }
        if ("look.entity".equals(action)) {
            return onClient(() -> {
                EntityPlayerSP player = requirePlayer();
                Entity entity = EntityFinder.find(player, requireFilter(params));
                Map<String, Object> rotated = lookAt(player, entity.posX, entity.posY + entity.getEyeHeight(), entity.posZ);
                Map<String, Object> result = new LinkedHashMap<String, Object>(rotated);
                result.put("entityId", entity.getEntityId());
                return result;
            });
        }
        if ("move.jump".equals(action)) {
            return onClient(() -> {
                EntityPlayerSP player = requirePlayer();
                player.motionY = 0.42D;
                return map("success", true, "position", positionMap(player));
            });
        }
        if ("move.sneak".equals(action)) {
            return onClient(() -> {
                boolean enabled = Params.booleanValue(params, "enabled", false);
                KeyBinding.setKeyBindState(client.gameSettings.keyBindSneak.getKeyCode(), enabled);
                return map("sneaking", enabled);
            });
        }
        if ("move.sprint".equals(action)) {
            return onClient(() -> {
                boolean enabled = Params.booleanValue(params, "enabled", false);
                KeyBinding.setKeyBindState(client.gameSettings.keyBindSprint.getKeyCode(), enabled);
                requirePlayer().setSprinting(enabled);
                return map("sprinting", enabled);
            });
        }
        if ("move.direction".equals(action)) {
            return moveDirection(params);
        }
        if ("move.to".equals(action)) {
            return moveTo(
                Params.requireDouble(params, "x"),
                Params.requireDouble(params, "y"),
                Params.requireDouble(params, "z"),
                Params.doubleValue(params, "timeout", MOVE_TO_TIMEOUT_SECONDS)
            );
        }
        throw new LegacyActionException("INVALID_ACTION");
    }

    public Map<String, Object> lookAt(EntityPlayerSP player, double x, double y, double z) {
        double eyeY = player.posY + player.getEyeHeight();
        double dx = x - player.posX;
        double dy = y - eyeY;
        double dz = z - player.posZ;
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        float yaw = MathHelper.wrapDegrees((float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0D));
        float pitch = MathHelper.wrapDegrees((float) (-Math.toDegrees(Math.atan2(dy, horizontal))));
        return setRotation(player, yaw, pitch);
    }

    public Map<String, Object> setRotation(EntityPlayerSP player, float yaw, float pitch) {
        player.rotationYaw = yaw;
        player.rotationPitch = pitch;
        player.rotationYawHead = yaw;
        player.renderYawOffset = yaw;
        return map("yaw", yaw, "pitch", pitch);
    }

    public void pressForward(long milliseconds) {
        pressKey(client.gameSettings.keyBindForward.getKeyCode(), milliseconds);
    }

    public void pressKey(int keyCode, long milliseconds) {
        onClient(() -> {
            KeyBinding.setKeyBindState(keyCode, true);
            return true;
        });
        MainThread.sleep(milliseconds);
        onClient(() -> {
            KeyBinding.setKeyBindState(keyCode, false);
            return true;
        });
        MainThread.sleep(40L);
    }

    public void pressMovementKeys(boolean forward, boolean back, boolean left, boolean right, boolean jump, boolean sneak, long milliseconds) {
        onClient(() -> {
            setMovementKeys(forward, back, left, right, jump, sneak);
            return true;
        });
        MainThread.sleep(milliseconds);
        onClient(() -> {
            setMovementKeys(false, false, false, false, false, false);
            return true;
        });
    }

    private void setMovementKeys(boolean forward, boolean back, boolean left, boolean right, boolean jump, boolean sneak) {
        KeyBinding.setKeyBindState(client.gameSettings.keyBindForward.getKeyCode(), forward);
        KeyBinding.setKeyBindState(client.gameSettings.keyBindBack.getKeyCode(), back);
        KeyBinding.setKeyBindState(client.gameSettings.keyBindLeft.getKeyCode(), left);
        KeyBinding.setKeyBindState(client.gameSettings.keyBindRight.getKeyCode(), right);
        KeyBinding.setKeyBindState(client.gameSettings.keyBindJump.getKeyCode(), jump);
        KeyBinding.setKeyBindState(client.gameSettings.keyBindSneak.getKeyCode(), sneak);
    }

    public Map<String, Object> moveTo(double x, double y, double z, double timeoutSeconds) {
        long startedAt = System.currentTimeMillis();
        Vec3d target = new Vec3d(x, y, z);
        double bestDistance = Double.MAX_VALUE;
        int stalledSteps = 0;
        boolean strafeLeft = true;

        while (elapsedSeconds(startedAt) < timeoutSeconds) {
            Map<String, Object> status = onClient(() -> {
                EntityPlayerSP player = requirePlayer();
                Vec3d position = new Vec3d(player.posX, player.posY, player.posZ);
                Vec3d delta = target.subtract(position);
                double horizontal = Math.sqrt(delta.x * delta.x + delta.z * delta.z);
                if (horizontal < 0.75D && Math.abs(delta.y) < 1.25D) {
                    Map<String, Object> result = new LinkedHashMap<String, Object>();
                    result.put("arrived", true);
                    result.put("finalPos", positionMap(player));
                    result.put("distance", position.distanceTo(target));
                    return result;
                }
                lookAt(player, target.x, target.y, target.z);
                if (delta.y > 0.6D && player.onGround) {
                    player.motionY = 0.42D;
                }
                return map(
                    "arrived", false,
                    "distance", position.distanceTo(target),
                    "horizontal", horizontal,
                    "vertical", Math.abs(delta.y)
                );
            });
            if (Boolean.TRUE.equals(status.get("arrived"))) {
                return status;
            }
            double currentDistance = ((Number) status.get("distance")).doubleValue();
            double currentHorizontal = ((Number) status.get("horizontal")).doubleValue();
            double currentVertical = ((Number) status.get("vertical")).doubleValue();
            if (currentDistance + 0.05D < bestDistance) {
                bestDistance = currentDistance;
                stalledSteps = 0;
            } else {
                stalledSteps++;
            }
            if (stalledSteps >= 4 && currentHorizontal < 2.75D && currentVertical < 1.5D) {
                return map(
                    "arrived", true,
                    "finalPos", onClient(() -> positionMap(requirePlayer())),
                    "distance", currentDistance
                );
            }
            if (stalledSteps >= 4) {
                pressMovementKeys(true, false, strafeLeft, !strafeLeft, true, false, 250L);
                strafeLeft = !strafeLeft;
                stalledSteps = 0;
                continue;
            }
            pressForward((long) (MOVE_STEP_SECONDS * 1000.0D));
        }

        return map(
            "arrived", false,
            "finalPos", onClient(() -> positionMap(requirePlayer())),
            "distance", onClient(() -> {
                EntityPlayerSP player = requirePlayer();
                return new Vec3d(player.posX, player.posY, player.posZ).distanceTo(target);
            })
        );
    }

    private Map<String, Object> moveDirection(JsonObject params) {
        String direction = Params.requireString(params, "direction");
        double blocks = Params.requireDouble(params, "blocks");
        int keyCode = directionKeyCode(direction);
        double[] start = onClient(() -> {
            EntityPlayerSP player = requirePlayer();
            return new double[] {player.posX, player.posY, player.posZ};
        });
        long deadline = System.currentTimeMillis() + (long) (Math.max(1.5D, Math.abs(blocks) * 2.0D) * 1000.0D);
        while (System.currentTimeMillis() < deadline) {
            double moved = onClient(() -> {
                EntityPlayerSP player = requirePlayer();
                double dx = player.posX - start[0];
                double dy = player.posY - start[1];
                double dz = player.posZ - start[2];
                return Math.sqrt(dx * dx + dy * dy + dz * dz);
            });
            if (moved >= Math.abs(blocks) - 0.15D) {
                break;
            }
            pressKey(keyCode, (long) (MOVE_STEP_SECONDS * 1000.0D));
        }
        return map("newPos", onClient(() -> positionMap(requirePlayer())));
    }

    private int directionKeyCode(String direction) {
        if ("forward".equals(direction)) {
            return client.gameSettings.keyBindForward.getKeyCode();
        }
        if ("back".equals(direction)) {
            return client.gameSettings.keyBindBack.getKeyCode();
        }
        if ("left".equals(direction)) {
            return client.gameSettings.keyBindLeft.getKeyCode();
        }
        if ("right".equals(direction)) {
            return client.gameSettings.keyBindRight.getKeyCode();
        }
        throw new LegacyActionException("INVALID_PARAMS");
    }

    static JsonObject requireFilter(JsonObject params) {
        if (!Params.has(params, "filter") || !params.get("filter").isJsonObject()) {
            throw new LegacyActionException("INVALID_PARAMS");
        }
        return params.getAsJsonObject("filter");
    }
}
