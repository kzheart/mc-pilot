package com.mct.legacy;

import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import net.minecraft.client.entity.EntityPlayerSP;
import net.minecraft.entity.Entity;
import net.minecraft.entity.item.EntityItem;
import net.minecraft.util.EnumActionResult;
import net.minecraft.util.EnumHand;

/** entity.* / combat.* — mirrors the modern EntityCombatHandler loops. */
public final class EntityCombatActions extends LegacyActions {

    private final MovementActions movement;

    public EntityCombatActions(MovementActions movement) {
        this.movement = movement;
    }

    @Override
    public Map<String, Object> handle(String action, JsonObject params) {
        if ("entity.list".equals(action)) {
            return onClient(() -> listEntities(params));
        }
        if ("entity.info".equals(action)) {
            return onClient(() -> entityInfo(params));
        }
        if ("entity.attack".equals(action)) {
            return onClient(() -> attackEntity(params));
        }
        if ("entity.interact".equals(action)) {
            return onClient(() -> interactEntity(params));
        }
        if ("entity.mount".equals(action)) {
            return mountEntity(params);
        }
        if ("entity.dismount".equals(action)) {
            return dismountEntity();
        }
        if ("entity.steer".equals(action)) {
            return steerEntity(params);
        }
        if ("combat.kill".equals(action)) {
            return combatAttackLoop(MovementActions.requireFilter(params), Params.doubleValue(params, "timeout", 30.0D));
        }
        if ("combat.engage".equals(action)) {
            return combatAttackLoop(MovementActions.requireFilter(params), Params.doubleValue(params, "timeout", 180.0D));
        }
        if ("combat.chase".equals(action)) {
            return combatAttackLoop(MovementActions.requireFilter(params), Params.doubleValue(params, "timeout", 120.0D));
        }
        if ("combat.clear".equals(action)) {
            return combatClear(params);
        }
        if ("combat.pickup".equals(action)) {
            return combatPickup(params);
        }
        throw new LegacyActionException("INVALID_ACTION");
    }

    private Map<String, Object> listEntities(JsonObject params) {
        EntityPlayerSP player = requirePlayer();
        double radius = Params.doubleValue(params, "radius", 10.0D);
        List<Map<String, Object>> entities = new ArrayList<Map<String, Object>>();
        for (Entity entity : client.world.loadedEntityList) {
            if (entity == player || player.getDistance(entity) > radius) {
                continue;
            }
            entities.add(Data.entityToMap(entity, player));
        }
        return map("entities", entities);
    }

    private Map<String, Object> entityInfo(JsonObject params) {
        EntityPlayerSP player = requirePlayer();
        Entity entity = client.world.getEntityByID(Params.requireInt(params, "id"));
        if (entity == null) {
            throw new LegacyActionException("ENTITY_NOT_FOUND");
        }
        return Data.entityToMap(entity, player);
    }

    private Map<String, Object> attackEntity(JsonObject params) {
        EntityPlayerSP player = requirePlayer();
        Entity entity = EntityFinder.find(player, MovementActions.requireFilter(params));
        requireController().attackEntity(player, entity);
        player.swingArm(EnumHand.MAIN_HAND);
        return map("success", true, "entityId", entity.getEntityId(), "entityType", Data.entityTypeId(entity));
    }

    private Map<String, Object> interactEntity(JsonObject params) {
        EntityPlayerSP player = requirePlayer();
        Entity entity = EntityFinder.find(player, MovementActions.requireFilter(params));
        EnumActionResult result = requireController().interactWithEntity(player, entity, EnumHand.MAIN_HAND);
        return map(
            "success", result == EnumActionResult.SUCCESS,
            "entityId", entity.getEntityId(),
            "entityType", Data.entityTypeId(entity)
        );
    }

    private Map<String, Object> mountEntity(JsonObject params) {
        Map<String, Object> interaction = onClient(() -> {
            EntityPlayerSP player = requirePlayer();
            Entity entity = EntityFinder.find(player, MovementActions.requireFilter(params));
            EnumActionResult result = requireController().interactWithEntity(player, entity, EnumHand.MAIN_HAND);
            return map("accepted", result == EnumActionResult.SUCCESS, "vehicleId", entity.getEntityId());
        });
        if (!Boolean.TRUE.equals(interaction.get("accepted"))) {
            return map("success", false, "vehicleId", -1);
        }
        Map<String, Object> mounted = pollUntil(
            2.0D,
            () -> {
                EntityPlayerSP player = requirePlayer();
                Entity vehicle = player.getRidingEntity();
                if (vehicle == null) {
                    return map();
                }
                return map("success", true, "vehicleId", vehicle.getEntityId());
            },
            result -> !result.isEmpty()
        );
        if (mounted == null || mounted.isEmpty()) {
            return map("success", false, "vehicleId", -1);
        }
        return mounted;
    }

    private Map<String, Object> dismountEntity() {
        boolean hadVehicle = onClient(() -> {
            EntityPlayerSP player = requirePlayer();
            boolean mounted = player.isRiding();
            if (mounted) {
                player.dismountRidingEntity();
            }
            return mounted;
        });
        if (!hadVehicle) {
            return map("success", false);
        }
        Boolean dismounted = pollUntil(2.0D, () -> !requirePlayer().isRiding(), done -> done);
        return map("success", Boolean.TRUE.equals(dismounted));
    }

    private Map<String, Object> steerEntity(JsonObject params) {
        boolean riding = onClient(() -> requirePlayer().isRiding());
        if (!riding) {
            throw new LegacyActionException("INVALID_STATE");
        }
        double forwardValue = Params.doubleValue(params, "forward", 0.0D);
        double sidewaysValue = Params.doubleValue(params, "sideways", 0.0D);
        movement.pressMovementKeys(
            forwardValue > 0.0D,
            forwardValue < 0.0D,
            sidewaysValue > 0.0D,
            sidewaysValue < 0.0D,
            Params.booleanValue(params, "jump", false),
            Params.booleanValue(params, "sneak", false),
            300L
        );
        return map("newPos", onClient(() -> positionMap(requirePlayer())));
    }

    private Map<String, Object> combatClear(JsonObject params) {
        String type = Data.normalizeEntityType(Params.requireString(params, "type"));
        double radius = Params.doubleValue(params, "radius", 16.0D);
        double timeoutSeconds = Params.doubleValue(params, "timeout", 60.0D);
        long startedAt = System.currentTimeMillis();
        int killed = 0;

        while (elapsedSeconds(startedAt) < timeoutSeconds) {
            JsonObject filter = new JsonObject();
            filter.addProperty("type", type);
            filter.addProperty("nearest", true);
            filter.addProperty("maxDistance", radius);
            try {
                Map<String, Object> result = combatAttackLoop(filter, Math.max(2.0D, timeoutSeconds - elapsedSeconds(startedAt)));
                if (Boolean.TRUE.equals(result.get("killed"))) {
                    killed += ((Number) result.get("killedCount")).intValue();
                    continue;
                }
            } catch (LegacyActionException exception) {
                if (!"ENTITY_NOT_FOUND".equals(exception.code)) {
                    throw exception;
                }
            }
            break;
        }

        int remaining = onClient(() -> EntityFinder.count(requirePlayer(), type, radius));
        return map("killed", killed, "duration", elapsedSeconds(startedAt), "remaining", remaining);
    }

    private Map<String, Object> combatPickup(JsonObject params) {
        double radius = Params.doubleValue(params, "radius", 5.0D);
        double timeoutSeconds = Params.doubleValue(params, "timeout", 10.0D);
        long startedAt = System.currentTimeMillis();
        List<Map<String, Object>> picked = new ArrayList<Map<String, Object>>();

        while (elapsedSeconds(startedAt) < timeoutSeconds) {
            Map<String, Object> next = onClient(() -> nearestItemEntity(radius));
            if (next.isEmpty()) {
                break;
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> item = (Map<String, Object>) next.get("item");
            picked.add(item);
            double remainingTimeout = Math.max(0.5D, timeoutSeconds - elapsedSeconds(startedAt));
            movement.moveTo(
                ((Number) next.get("x")).doubleValue(),
                ((Number) next.get("y")).doubleValue(),
                ((Number) next.get("z")).doubleValue(),
                remainingTimeout
            );
            int entityId = ((Number) next.get("entityId")).intValue();
            double pickupWaitTimeout = Math.min(2.0D, Math.max(0.2D, timeoutSeconds - elapsedSeconds(startedAt)));
            pollUntil(pickupWaitTimeout, () -> {
                requirePlayer();
                return client.world.getEntityByID(entityId) == null;
            }, done -> done);
        }

        return map("picked", picked);
    }

    private Map<String, Object> combatAttackLoop(JsonObject filter, double timeoutSeconds) {
        long startedAt = System.currentTimeMillis();
        int hits = 0;
        Integer lastTargetId = null;

        while (elapsedSeconds(startedAt) < timeoutSeconds) {
            Map<String, Object> target = onClient(() -> currentTargetState(filter));
            if (target.isEmpty()) {
                return map(
                    "killed", lastTargetId != null,
                    "hits", hits,
                    "duration", elapsedSeconds(startedAt),
                    "killedCount", lastTargetId != null ? 1 : 0
                );
            }

            lastTargetId = Integer.valueOf(((Number) target.get("entityId")).intValue());
            double distance = ((Number) target.get("distance")).doubleValue();
            if (distance > 2.9D) {
                approachTargetStep(target, timeoutSeconds - elapsedSeconds(startedAt));
                MainThread.sleep(100L);
                continue;
            }

            Integer targetId = lastTargetId;
            Boolean attacked = onClient(() -> {
                EntityPlayerSP player = requirePlayer();
                Entity entity = client.world.getEntityByID(targetId.intValue());
                if (entity == null || !entity.isEntityAlive()) {
                    return false;
                }
                movement.lookAt(player, entity.posX, entity.posY + entity.getEyeHeight(), entity.posZ);
                if (player.getCooledAttackStrength(0.0F) < 0.9F) {
                    return false;
                }
                requireController().attackEntity(player, entity);
                player.swingArm(EnumHand.MAIN_HAND);
                return true;
            });
            if (Boolean.TRUE.equals(attacked)) {
                hits++;
                double confirmTimeout = Math.min(1.5D, Math.max(0.4D, timeoutSeconds - elapsedSeconds(startedAt) + 0.5D));
                if (waitForTargetDefeat(lastTargetId, filter, confirmTimeout)) {
                    return map("killed", true, "hits", hits, "duration", elapsedSeconds(startedAt), "killedCount", 1);
                }
            }
            MainThread.sleep(150L);
        }

        boolean defeated = hits > 0 && waitForTargetDefeat(lastTargetId, filter, 2.5D);
        return map("killed", defeated, "hits", hits, "duration", elapsedSeconds(startedAt), "killedCount", defeated ? 1 : 0);
    }

    private void approachTargetStep(Map<String, Object> target, double remainingTimeoutSeconds) {
        if (remainingTimeoutSeconds <= 0.2D) {
            return;
        }
        double[] nextStep = onClient(() -> {
            EntityPlayerSP player = requirePlayer();
            double targetX = ((Number) target.get("x")).doubleValue();
            double targetY = ((Number) target.get("y")).doubleValue();
            double targetZ = ((Number) target.get("z")).doubleValue();
            double dx = targetX - player.posX;
            double dz = targetZ - player.posZ;
            double horizontal = Math.sqrt(dx * dx + dz * dz);
            double travel = horizontal < 0.001D ? 0.0D : Math.min(1.6D, Math.max(0.45D, horizontal - 2.2D));
            double scale = horizontal < 0.001D ? 0.0D : travel / horizontal;
            return new double[] {
                player.posX + (dx * scale),
                Math.abs(targetY - player.posY) > 0.9D ? targetY : player.posY,
                player.posZ + (dz * scale)
            };
        });
        movement.moveTo(nextStep[0], nextStep[1], nextStep[2], Math.max(0.5D, Math.min(1.5D, remainingTimeoutSeconds)));
    }

    private Map<String, Object> currentTargetState(JsonObject filter) {
        try {
            EntityPlayerSP player = requirePlayer();
            Entity entity = EntityFinder.find(player, filter);
            if (!EntityFinder.isSelectable(entity)) {
                return map();
            }
            return map(
                "entityId", entity.getEntityId(),
                "x", entity.posX,
                "y", entity.posY,
                "z", entity.posZ,
                "distance", (double) player.getDistance(entity)
            );
        } catch (LegacyActionException exception) {
            if ("ENTITY_NOT_FOUND".equals(exception.code)) {
                return map();
            }
            throw exception;
        }
    }

    private Map<String, Object> nearestItemEntity(double radius) {
        EntityPlayerSP player = requirePlayer();
        EntityItem nearest = null;
        for (Entity entity : client.world.loadedEntityList) {
            if (!(entity instanceof EntityItem)) {
                continue;
            }
            EntityItem itemEntity = (EntityItem) entity;
            if (player.getDistance(itemEntity) > radius) {
                continue;
            }
            if (nearest == null || player.getDistance(itemEntity) < player.getDistance(nearest)) {
                nearest = itemEntity;
            }
        }
        if (nearest == null) {
            return map();
        }
        return map(
            "entityId", nearest.getEntityId(),
            "x", nearest.posX,
            "y", nearest.posY,
            "z", nearest.posZ,
            "item", Data.itemToMap(nearest.getItem())
        );
    }

    private boolean waitForTargetDefeat(Integer entityId, JsonObject filter, double timeoutSeconds) {
        if (entityId == null || timeoutSeconds <= 0.0D) {
            return false;
        }
        Boolean defeated = pollUntil(
            timeoutSeconds,
            () -> {
                requirePlayer();
                boolean gone = !EntityFinder.isSelectable(client.world.getEntityByID(entityId.intValue()));
                return gone || currentTargetState(filter).isEmpty();
            },
            done -> done
        );
        return Boolean.TRUE.equals(defeated);
    }
}
