package com.mct.core.util;

import com.mct.mixin.HandledScreenAccessor;
import com.mct.version.ClientVersionModulesHolder;
import com.mct.version.McRegistries;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.chat.Component;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.entity.SignBlockEntity;
import net.minecraft.world.scores.PlayerTeam;

public final class ClientDataHelper {

    private ClientDataHelper() {
    }

    public static Map<String, Object> itemToMap(ItemStack stack) {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        if (stack == null || stack.isEmpty()) {
            result.put("empty", true);
            result.put("type", "minecraft:air");
            result.put("count", 0);
            return result;
        }

        result.put("empty", false);
        result.put("type", String.valueOf(McRegistries.itemId(stack.getItem())));
        result.put("count", stack.getCount());
        result.put("displayName", stack.getHoverName().getString());

        ClientVersionModulesHolder.get().itemData().appendCustomData(stack, result);

        if (stack.isDamageableItem()) {
            result.put(
                "durability",
                com.mct.core.util.MctMaps.mapOf(
                    "current", Math.max(0, stack.getMaxDamage() - stack.getDamageValue()),
                    "max", stack.getMaxDamage(),
                    "damage", stack.getDamageValue()
                )
            );
        }

        List<Map<String, Object>> enchantments = ClientVersionModulesHolder.get().itemData().getEnchantments(stack);
        if (!enchantments.isEmpty()) {
            result.put("enchantments", enchantments);
        }

        return result;
    }

    public static List<Map<String, Object>> slotsToList(List<Slot> slots) {
        return slotsToList(slots, null);
    }

    public static List<Map<String, Object>> slotsToList(List<Slot> slots, AbstractContainerScreen<?> screen) {
        ArrayList<Map<String, Object>> values = new ArrayList<>();
        HandledScreenAccessor accessor = screen instanceof HandledScreenAccessor handledAccessor ? handledAccessor : null;
        for (Slot slot : slots) {
            values.add(slotToMap(slot, accessor));
        }
        return values;
    }

    public static Map<String, Object> slotToMap(Slot slot, AbstractContainerScreen<?> screen) {
        HandledScreenAccessor accessor = screen instanceof HandledScreenAccessor handledAccessor ? handledAccessor : null;
        return slotToMap(slot, accessor);
    }

    private static Map<String, Object> slotToMap(Slot slot, HandledScreenAccessor accessor) {
        LinkedHashMap<String, Object> slotMap = new LinkedHashMap<>();
        slotMap.put("slot", slot.index);
        slotMap.put("index", slot.getContainerSlot());
        slotMap.put("localX", slot.x);
        slotMap.put("localY", slot.y);
        slotMap.put("width", 18);
        slotMap.put("height", 18);
        if (accessor != null) {
            int screenX = accessor.mct$getX() + slot.x;
            int screenY = accessor.mct$getY() + slot.y;
            slotMap.put("screenX", screenX);
            slotMap.put("screenY", screenY);
            slotMap.put("centerX", screenX + 8);
            slotMap.put("centerY", screenY + 8);
        }
        slotMap.put("hasStack", slot.hasItem());
        slotMap.put("item", itemToMap(slot.getItem()));
        return slotMap;
    }

    public static Map<String, Object> entityToMap(Entity entity, LocalPlayer player) {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("id", entity.getId());
        result.put("uuid", entity.getStringUUID());
        result.put("type", String.valueOf(McRegistries.entityTypeId(entity.getType())));
        result.put("name", entity.getName().getString());
        result.put(
            "pos",
            com.mct.core.util.MctMaps.mapOf(
                "x", entity.getX(),
                "y", entity.getY(),
                "z", entity.getZ()
            )
        );
        result.put("yaw", entity.getYRot());
        result.put("pitch", entity.getXRot());
        result.put("distance", player != null ? player.distanceTo(entity) : 0.0D);
        result.put("alive", entity.isAlive());
        if (entity instanceof LivingEntity livingEntity) {
            result.put("health", livingEntity.getHealth());
            result.put("maxHealth", livingEntity.getMaxHealth());
            result.put("effects", effectsToList(livingEntity.getActiveEffects()));
        }
        return result;
    }

    public static List<Map<String, Object>> effectsToList(Iterable<MobEffectInstance> effects) {
        ArrayList<Map<String, Object>> values = new ArrayList<>();
        for (MobEffectInstance effect : effects) {
            values.add(
                com.mct.core.util.MctMaps.mapOf(
                    "id", ClientVersionModulesHolder.get().itemData().statusEffectId(effect),
                    "amplifier", effect.getAmplifier(),
                    "duration", effect.getDuration(),
                    "ambient", effect.isAmbient(),
                    "visible", effect.isVisible()
                )
            );
        }
        return values;
    }

    public static Map<String, Object> screenToMap(Minecraft client) {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        Screen screen = client.gui.screen();
        if (screen == null) {
            result.put("open", false);
            return result;
        }

        result.put("open", true);
        try {
            result.put("type", screen.getClass().getSimpleName());
            Component title = screen.getTitle();
            result.put("title", title != null ? title.getString() : "");
            result.put("category", SessionReliability.screenCategory(client));
            result.put("disconnectReason", SessionReliability.disconnectReason(client));
            result.put("width", screen.width);
            result.put("height", screen.height);

            if (screen instanceof AbstractContainerScreen<?> handledScreen) {
                AbstractContainerMenu handler = handledScreen.getMenu();
                HandledScreenAccessor accessor = (HandledScreenAccessor) handledScreen;
                result.put("syncId", handler != null ? handler.containerId : -1);
                result.put("size", handler != null ? handler.slots.size() : 0);
                result.put("guiLeft", accessor.mct$getX());
                result.put("guiTop", accessor.mct$getY());
                result.put("backgroundWidth", accessor.mct$getBackgroundWidth());
                result.put("backgroundHeight", accessor.mct$getBackgroundHeight());
                result.put("titleX", accessor.mct$getTitleX());
                result.put("titleY", accessor.mct$getTitleY());
                result.put("titleScreenX", accessor.mct$getX() + accessor.mct$getTitleX());
                result.put("titleScreenY", accessor.mct$getY() + accessor.mct$getTitleY());
                result.put("playerInventoryTitleX", accessor.mct$getPlayerInventoryTitleX());
                result.put("playerInventoryTitleY", accessor.mct$getPlayerInventoryTitleY());
                result.put("playerInventoryTitleScreenX", accessor.mct$getX() + accessor.mct$getPlayerInventoryTitleX());
                result.put("playerInventoryTitleScreenY", accessor.mct$getY() + accessor.mct$getPlayerInventoryTitleY());
                result.put(
                    "bounds",
                    com.mct.core.util.MctMaps.mapOf(
                        "x", accessor.mct$getX(),
                        "y", accessor.mct$getY(),
                        "width", accessor.mct$getBackgroundWidth(),
                        "height", accessor.mct$getBackgroundHeight()
                    )
                );
                result.put(
                    "handlerType",
                    handler != null && handler.getType() != null ? String.valueOf(McRegistries.screenHandlerId(handler.getType())) : "player"
                );
            } else {
                result.put("syncId", -1);
                result.put("size", 0);
            }
        } catch (RuntimeException exception) {
            result.put("mappingError", exception.getClass().getSimpleName());
        }
        return result;
    }

    public static List<String> signText(SignBlockEntity sign, boolean front, boolean filtered) {
        return ClientVersionModulesHolder.get().sign().signText(sign, front, filtered);
    }

    public static Map<String, Object> playerListEntryToMap(PlayerInfo entry, Component displayName, PlayerTeam team) {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        String profileName = ClientVersionModulesHolder.get().compatibility().profileName(entry);
        result.put("name", profileName);
        result.put("displayName", displayName != null ? displayName.getString() : profileName);
        result.put("latency", entry.getLatency());
        result.put("gameMode", ClientVersionModulesHolder.get().compatibility().gameModeName(entry.getGameMode()));
        if (team != null) {
            result.put("team", team.getName());
            result.put("prefix", team.getPlayerPrefix().getString());
            result.put("suffix", team.getPlayerSuffix().getString());
        }
        return result;
    }
}
