package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.*;

import com.mct.core.util.ActionException;
import com.mct.version.McRegistries;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.entity.Entity;
import net.minecraft.entity.LivingEntity;
import org.jetbrains.annotations.Nullable;

public final class EntityHelper {

    private EntityHelper() {
    }

    public static Entity findEntity(ClientPlayerEntity player, Map<String, Object> filter) {
        Integer requestedId = filter.containsKey("id") ? asInt(filter.get("id")) : null;
        String type = filter.containsKey("type") ? normalizeEntityType(String.valueOf(filter.get("type"))) : null;
        String namePattern = filter.containsKey("name") ? String.valueOf(filter.get("name")) : null;
        Double maxDistance = filter.containsKey("maxDistance") ? asDouble(filter.get("maxDistance")) : null;
        boolean nearest = filter.containsKey("nearest") && Boolean.TRUE.equals(filter.get("nearest"));

        List<Entity> entities = new ArrayList<>();
        for (Entity entity : player.clientWorld.getEntities()) {
            if (entity == player) {
                continue;
            }
            if (!isEntitySelectable(entity)) {
                continue;
            }
            if (requestedId != null && entity.getId() != requestedId) {
                continue;
            }
            if (type != null && !normalizeEntityType(String.valueOf(McRegistries.entityTypeId(entity.getType()))).equals(type)) {
                continue;
            }
            if (namePattern != null && !entity.getName().getString().matches(namePattern) && !entity.getName().getString().contains(namePattern)) {
                continue;
            }
            if (maxDistance != null && player.distanceTo(entity) > maxDistance.floatValue()) {
                continue;
            }
            entities.add(entity);
        }

        if (entities.isEmpty()) {
            throw new ActionException("ENTITY_NOT_FOUND");
        }
        entities.sort(Comparator.comparingDouble(player::distanceTo));
        return entities.get(0);
    }

    public static int countEntities(ClientPlayerEntity player, Map<String, Object> filter) {
        String type = filter.containsKey("type") ? normalizeEntityType(String.valueOf(filter.get("type"))) : null;
        Double maxDistance = filter.containsKey("maxDistance") ? asDouble(filter.get("maxDistance")) : null;
        int count = 0;
        for (Entity entity : player.clientWorld.getEntities()) {
            if (entity == player) {
                continue;
            }
            if (!isEntitySelectable(entity)) {
                continue;
            }
            if (type != null && !normalizeEntityType(String.valueOf(McRegistries.entityTypeId(entity.getType()))).equals(type)) {
                continue;
            }
            if (maxDistance != null && player.distanceTo(entity) > maxDistance.floatValue()) {
                continue;
            }
            count++;
        }
        return count;
    }

    public static boolean isEntitySelectable(@Nullable Entity entity) {
        if (entity == null || !entity.isAlive()) {
            return false;
        }
        if (entity instanceof LivingEntity living && living.getHealth() <= 0.0F) {
            return false;
        }
        return true;
    }

    public static String normalizeEntityType(String value) {
        String normalized = value.contains(":") ? value : "minecraft:" + value;
        return normalized.toLowerCase(Locale.ROOT);
    }
}
