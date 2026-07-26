package com.mct.legacy;

import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import net.minecraft.client.entity.EntityPlayerSP;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityLivingBase;

/** Entity filter semantics mirroring the modern EntityHelper. */
public final class EntityFinder {

    private EntityFinder() {
    }

    public static Entity find(EntityPlayerSP player, JsonObject filter) {
        Integer requestedId = Params.has(filter, "id") ? Integer.valueOf(Params.requireInt(filter, "id")) : null;
        String type = Params.has(filter, "type") ? Data.normalizeEntityType(Params.string(filter, "type")) : null;
        String namePattern = Params.has(filter, "name") ? Params.string(filter, "name") : null;
        Double maxDistance = Params.has(filter, "maxDistance") ? Double.valueOf(Params.requireDouble(filter, "maxDistance")) : null;

        List<Entity> entities = new ArrayList<Entity>();
        for (Entity entity : player.world.loadedEntityList) {
            if (entity == player || !isSelectable(entity)) {
                continue;
            }
            if (requestedId != null && entity.getEntityId() != requestedId.intValue()) {
                continue;
            }
            if (type != null && !Data.normalizeEntityType(Data.entityTypeId(entity)).equals(type)) {
                continue;
            }
            if (namePattern != null && !entity.getName().matches(namePattern) && !entity.getName().contains(namePattern)) {
                continue;
            }
            if (maxDistance != null && player.getDistance(entity) > maxDistance.floatValue()) {
                continue;
            }
            entities.add(entity);
        }
        if (entities.isEmpty()) {
            throw new LegacyActionException("ENTITY_NOT_FOUND");
        }
        entities.sort(Comparator.comparingDouble(entity -> (double) player.getDistance(entity)));
        return entities.get(0);
    }

    public static int count(EntityPlayerSP player, String type, double maxDistance) {
        int count = 0;
        for (Entity entity : player.world.loadedEntityList) {
            if (entity == player || !isSelectable(entity)) {
                continue;
            }
            if (type != null && !Data.normalizeEntityType(Data.entityTypeId(entity)).equals(type)) {
                continue;
            }
            if (player.getDistance(entity) > maxDistance) {
                continue;
            }
            count++;
        }
        return count;
    }

    public static boolean isSelectable(Entity entity) {
        if (entity == null || !entity.isEntityAlive()) {
            return false;
        }
        if (entity instanceof EntityLivingBase && ((EntityLivingBase) entity).getHealth() <= 0.0F) {
            return false;
        }
        return true;
    }
}
