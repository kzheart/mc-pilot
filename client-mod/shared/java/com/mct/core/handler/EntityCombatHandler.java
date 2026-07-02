package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.getBoolean;
import static com.mct.core.util.ParamHelper.getDouble;
import static com.mct.core.util.ParamHelper.getInt;
import static com.mct.core.util.ParamHelper.getRequired;
import static com.mct.core.util.ParamHelper.getString;
import static com.mct.core.util.ParamHelper.asDouble;
import static com.mct.core.util.ParamHelper.asInt;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.core.util.ClientDataHelper;
import com.mct.version.McRegistries;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.entity.Entity;
import net.minecraft.entity.ItemEntity;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import org.jetbrains.annotations.Nullable;

public final class EntityCombatHandler extends ActionHandler {

    private final MovementHandler movementHandler;
    private final InputHandler inputHandler;

    public EntityCombatHandler(MinecraftClient client, ClientStateTracker stateTracker, MovementHandler movementHandler, InputHandler inputHandler) {
        super(client, stateTracker);
        this.movementHandler = movementHandler;
        this.inputHandler = inputHandler;
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
            case "entity.list" -> runOnClientThread(() -> listEntities(params));
            case "entity.info" -> runOnClientThread(() -> entityInfo(params));
            case "entity.attack" -> runOnClientThread(() -> attackEntity(params));
            case "entity.interact" -> runOnClientThread(() -> interactEntity(params));
            case "entity.mount" -> mountEntity(params);
            case "entity.dismount" -> dismountEntity();
            case "entity.steer" -> steerEntity(params);
            case "combat.kill" -> combatKill(params);
            case "combat.clear" -> combatClear(params);
            case "combat.engage" -> combatEngage(params);
            case "combat.chase" -> combatChase(params);
            case "combat.pickup" -> combatPickup(params);
            default -> throw new ActionException("INVALID_ACTION");
        };
    }

    private Map<String, Object> listEntities(Map<String, Object> params) {
        ClientPlayerEntity player = requirePlayer();
        double radius = getDouble(params, "radius", 10.0D);
        ArrayList<Map<String, Object>> entities = new ArrayList<>();
        for (Entity entity : clientWorld(player).getEntities()) {
            if (entity == player || player.distanceTo(entity) > radius) {
                continue;
            }
            entities.add(ClientDataHelper.entityToMap(entity, player));
        }
        return com.mct.core.util.MctMaps.mapOf("entities", entities);
    }

    private Map<String, Object> entityInfo(Map<String, Object> params) {
        int id = getInt(params, "id");
        Entity entity = clientWorld(requirePlayer()).getEntityById(id);
        if (entity == null) {
            throw new ActionException("ENTITY_NOT_FOUND");
        }
        return ClientDataHelper.entityToMap(entity, requirePlayer());
    }

    private Map<String, Object> attackEntity(Map<String, Object> params) {
        ClientPlayerEntity player = requirePlayer();
        Entity entity = EntityHelper.findEntity(player, requireFilter(params));
        requireInteractionManager().attackEntity(player, entity);
        player.swingHand(Hand.MAIN_HAND);
        return com.mct.core.util.MctMaps.mapOf("success", true, "entityId", entity.getId(), "entityType", String.valueOf(McRegistries.entityTypeId(entity.getType())));
    }

    private Map<String, Object> interactEntity(Map<String, Object> params) {
        ClientPlayerEntity player = requirePlayer();
        Entity entity = EntityHelper.findEntity(player, requireFilter(params));
        ActionResult result = requireInteractionManager().interactEntity(player, entity, Hand.MAIN_HAND);
        return com.mct.core.util.MctMaps.mapOf("success", result.isAccepted(), "entityId", entity.getId(), "entityType", String.valueOf(McRegistries.entityTypeId(entity.getType())));
    }

    private Map<String, Object> mountEntity(Map<String, Object> params) {
        Map<String, Object> interaction = runOnClientThread(() -> {
            ClientPlayerEntity player = requirePlayer();
            Entity entity = EntityHelper.findEntity(player, requireFilter(params));
            ActionResult result = requireInteractionManager().interactEntity(player, entity, Hand.MAIN_HAND);
            return com.mct.core.util.MctMaps.mapOf("accepted", result.isAccepted(), "vehicleId", entity.getId());
        });
        if (!Boolean.TRUE.equals(interaction.get("accepted"))) {
            return com.mct.core.util.MctMaps.mapOf("success", false, "vehicleId", -1);
        }
        Map<String, Object> mounted = pollUntil(
            2.0D,
            () -> {
                ClientPlayerEntity player = requirePlayer();
                Entity vehicle = player.getVehicle();
                if (vehicle == null) {
                    return com.mct.core.util.MctMaps.mapOf();
                }
                return com.mct.core.util.MctMaps.mapOf("success", true, "vehicleId", vehicle.getId());
            },
            result -> !result.isEmpty()
        );
        if (mounted.isEmpty()) {
            return com.mct.core.util.MctMaps.mapOf("success", false, "vehicleId", -1);
        }
        return mounted;
    }

    private Map<String, Object> dismountEntity() {
        boolean hadVehicle = runOnClientThread(() -> {
            ClientPlayerEntity player = requirePlayer();
            boolean mounted = player.hasVehicle();
            if (mounted) {
                player.dismountVehicle();
            }
            return mounted;
        });
        if (!hadVehicle) {
            return com.mct.core.util.MctMaps.mapOf("success", false);
        }
        Boolean dismounted = pollUntil(2.0D, () -> !requirePlayer().hasVehicle(), Boolean::booleanValue);
        return com.mct.core.util.MctMaps.mapOf("success", Boolean.TRUE.equals(dismounted));
    }

    private Map<String, Object> steerEntity(Map<String, Object> params) {
        if (!requirePlayer().hasVehicle()) {
            throw new ActionException("INVALID_STATE");
        }
        boolean forward = getDouble(params, "forward", 0.0D) > 0.0D;
        boolean back = getDouble(params, "forward", 0.0D) < 0.0D;
        boolean left = getDouble(params, "sideways", 0.0D) > 0.0D;
        boolean right = getDouble(params, "sideways", 0.0D) < 0.0D;
        boolean jump = getBoolean(params, "jump", false);
        boolean sneak = getBoolean(params, "sneak", false);
        inputHandler.pressMovementKeys(forward, back, left, right, jump, sneak, 300L);
        return runOnClientThread(() -> com.mct.core.util.MctMaps.mapOf("newPos", positionMap(requirePlayer())));
    }

    private Map<String, Object> combatKill(Map<String, Object> params) {
        return combatAttackLoop(requireFilter(params), getDouble(params, "timeout", 30.0D), true);
    }

    private Map<String, Object> combatEngage(Map<String, Object> params) {
        return combatAttackLoop(requireFilter(params), getDouble(params, "timeout", 180.0D), true);
    }

    private Map<String, Object> combatChase(Map<String, Object> params) {
        return combatAttackLoop(requireFilter(params), getDouble(params, "timeout", 120.0D), true);
    }

    private Map<String, Object> combatClear(Map<String, Object> params) {
        String type = EntityHelper.normalizeEntityType(getString(params, "type"));
        double radius = getDouble(params, "radius", 16.0D);
        double timeoutSeconds = getDouble(params, "timeout", 60.0D);
        Instant startedAt = Instant.now();
        int killed = 0;

        while (Duration.between(startedAt, Instant.now()).toMillis() < (long) (timeoutSeconds * 1000.0D)) {
            Map<String, Object> filter = com.mct.core.util.MctMaps.mapOf("type", type, "nearest", true, "maxDistance", radius);
            try {
                Map<String, Object> result = combatAttackLoop(filter, Math.max(2.0D, timeoutSeconds - elapsedSeconds(startedAt)), true);
                if (Boolean.TRUE.equals(result.get("killed"))) {
                    killed += asInt(result.get("killedCount"));
                    continue;
                }
            } catch (ActionException exception) {
                if (!"ENTITY_NOT_FOUND".equals(exception.getCode())) {
                    throw exception;
                }
            }
            break;
        }

        int remaining = runOnClientThread(() -> EntityHelper.countEntities(requirePlayer(), com.mct.core.util.MctMaps.mapOf("type", type, "maxDistance", radius)));
        return com.mct.core.util.MctMaps.mapOf("killed", killed, "duration", elapsedSeconds(startedAt), "remaining", remaining);
    }

    private Map<String, Object> combatPickup(Map<String, Object> params) {
        double radius = getDouble(params, "radius", 5.0D);
        double timeoutSeconds = getDouble(params, "timeout", 10.0D);
        Instant startedAt = Instant.now();
        ArrayList<Map<String, Object>> picked = new ArrayList<>();

        while (Duration.between(startedAt, Instant.now()).toMillis() < (long) (timeoutSeconds * 1000.0D)) {
            Map<String, Object> next = runOnClientThread(() -> nearestItemEntity(radius));
            if (next.isEmpty()) {
                break;
            }
            picked.add((Map<String, Object>) next.get("item"));
            double remainingTimeout = Math.max(0.5D, timeoutSeconds - elapsedSeconds(startedAt));
            movementHandler.moveTo(com.mct.core.util.MctMaps.mapOf("x", next.get("x"), "y", next.get("y"), "z", next.get("z"), "timeout", remainingTimeout));
            int entityId = asInt(next.get("entityId"));
            double pickupWaitTimeout = Math.min(2.0D, Math.max(0.2D, timeoutSeconds - elapsedSeconds(startedAt)));
            pollUntil(pickupWaitTimeout, () -> clientWorld(requirePlayer()).getEntityById(entityId) == null, Boolean::booleanValue);
        }

        return com.mct.core.util.MctMaps.mapOf("picked", picked);
    }

    private Map<String, Object> combatAttackLoop(Map<String, Object> filter, double timeoutSeconds, boolean approachTarget) {
        Instant startedAt = Instant.now();
        int hits = 0;
        Integer lastTargetId = null;

        while (Duration.between(startedAt, Instant.now()).toMillis() < (long) (timeoutSeconds * 1000.0D)) {
            Map<String, Object> target = currentTargetState(filter);
            if (target.isEmpty()) {
                return com.mct.core.util.MctMaps.mapOf(
                    "killed", lastTargetId != null,
                    "hits", hits,
                    "duration", elapsedSeconds(startedAt),
                    "killedCount", lastTargetId != null ? 1 : 0
                );
            }

            lastTargetId = asInt(target.get("entityId"));
            double distance = asDouble(target.get("distance"));
            if (approachTarget && distance > 2.9D) {
                approachCombatTargetStep(target, timeoutSeconds - elapsedSeconds(startedAt));
                safeSleep(100L);
                continue;
            }
            if (distance > 4.5D) {
                safeSleep(100L);
                continue;
            }

            Boolean attacked = runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                Entity entity = clientWorld(player).getEntityById(asInt(target.get("entityId")));
                if (entity == null || !entity.isAlive()) {
                    return false;
                }
                movementHandler.lookAt(player, entity.getX(), entity.getEyeY(), entity.getZ());
                if (player.getAttackCooldownProgress(0.0F) < 0.9F) {
                    return false;
                }
                requireInteractionManager().attackEntity(player, entity);
                player.swingHand(Hand.MAIN_HAND);
                return true;
            });
            if (Boolean.TRUE.equals(attacked)) {
                hits++;
                double confirmTimeout = Math.min(1.5D, Math.max(0.4D, timeoutSeconds - elapsedSeconds(startedAt) + 0.5D));
                if (waitForCombatTargetDefeat(lastTargetId, filter, confirmTimeout)) {
                    return com.mct.core.util.MctMaps.mapOf("killed", true, "hits", hits, "duration", elapsedSeconds(startedAt), "killedCount", 1);
                }
            }
            safeSleep(150L);
        }

        boolean defeated = hits > 0 && waitForCombatTargetDefeat(lastTargetId, filter, 2.5D);
        return com.mct.core.util.MctMaps.mapOf("killed", defeated, "hits", hits, "duration", elapsedSeconds(startedAt), "killedCount", defeated ? 1 : 0);
    }

    private void approachCombatTargetStep(Map<String, Object> target, double remainingTimeoutSeconds) {
        if (remainingTimeoutSeconds <= 0.2D) {
            return;
        }
        Map<String, Object> nextStep = runOnClientThread(() -> {
            ClientPlayerEntity player = requirePlayer();
            double targetX = asDouble(target.get("x"));
            double targetY = asDouble(target.get("y"));
            double targetZ = asDouble(target.get("z"));
            double dx = targetX - player.getX();
            double dz = targetZ - player.getZ();
            double horizontal = Math.sqrt(dx * dx + dz * dz);
            double travel = horizontal < 0.001D ? 0.0D : Math.min(1.6D, Math.max(0.45D, horizontal - 2.2D));
            double scale = horizontal < 0.001D ? 0.0D : travel / horizontal;

            LinkedHashMap<String, Object> result = new LinkedHashMap<>();
            result.put("x", player.getX() + (dx * scale));
            result.put("y", Math.abs(targetY - player.getY()) > 0.9D ? targetY : player.getY());
            result.put("z", player.getZ() + (dz * scale));
            result.put("timeout", Math.max(0.5D, Math.min(1.5D, remainingTimeoutSeconds)));
            return result;
        });
        movementHandler.moveTo(nextStep);
    }

    private Map<String, Object> requireFilter(Map<String, Object> params) {
        Object filter = getRequired(params, "filter");
        if (!(filter instanceof Map<?, ?> rawFilter)) {
            throw new ActionException("INVALID_PARAMS");
        }
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        rawFilter.forEach((key, value) -> result.put(String.valueOf(key), value));
        return result;
    }

    private Map<String, Object> currentTargetState(Map<String, Object> filter) {
        return runOnClientThread(() -> currentTargetStateOnClientThread(filter));
    }

    private Map<String, Object> currentTargetStateOnClientThread(Map<String, Object> filter) {
        try {
            Entity entity = EntityHelper.findEntity(requirePlayer(), filter);
            if (!EntityHelper.isEntitySelectable(entity)) {
                return com.mct.core.util.MctMaps.mapOf();
            }
            return com.mct.core.util.MctMaps.mapOf(
                "entityId", entity.getId(),
                "x", entity.getX(),
                "y", entity.getY(),
                "z", entity.getZ(),
                "distance", requirePlayer().distanceTo(entity)
            );
        } catch (ActionException exception) {
            if ("ENTITY_NOT_FOUND".equals(exception.getCode())) {
                return com.mct.core.util.MctMaps.mapOf();
            }
            throw exception;
        }
    }

    private Map<String, Object> nearestItemEntity(double radius) {
        ClientPlayerEntity player = requirePlayer();
        ItemEntity nearest = null;
        for (Entity entity : clientWorld(player).getEntities()) {
            if (!(entity instanceof ItemEntity itemEntity)) {
                continue;
            }
            if (player.distanceTo(itemEntity) > radius) {
                continue;
            }
            if (nearest == null || player.distanceTo(itemEntity) < player.distanceTo(nearest)) {
                nearest = itemEntity;
            }
        }
        if (nearest == null) {
            return com.mct.core.util.MctMaps.mapOf();
        }
        return com.mct.core.util.MctMaps.mapOf(
            "entityId", nearest.getId(),
            "x", nearest.getX(),
            "y", nearest.getY(),
            "z", nearest.getZ(),
            "item", ClientDataHelper.itemToMap(nearest.getStack())
        );
    }

    private boolean waitForCombatTargetDefeat(@Nullable Integer entityId, Map<String, Object> filter, double timeoutSeconds) {
        if (entityId == null || timeoutSeconds <= 0.0D) {
            return false;
        }
        Boolean defeated = pollUntil(
            timeoutSeconds,
            () -> targetDefeatedOnClientThread(entityId) || currentTargetStateOnClientThread(filter).isEmpty(),
            Boolean::booleanValue
        );
        return Boolean.TRUE.equals(defeated);
    }

    private boolean targetDefeatedOnClientThread(@Nullable Integer entityId) {
        if (entityId == null) {
            return false;
        }
        return !EntityHelper.isEntitySelectable(clientWorld(requirePlayer()).getEntityById(entityId));
    }
}
