package com.mct.core.util;

import com.mct.mixin.HandledScreenAccessor;
import com.mct.version.ClientVersionModulesHolder;
import com.mct.version.McRegistries;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.block.entity.SignBlockEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.ingame.HandledScreen;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.entity.Entity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.item.ItemStack;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.slot.Slot;
import net.minecraft.scoreboard.Team;
import net.minecraft.text.Text;

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
        result.put("displayName", stack.getName().getString());

        ClientVersionModulesHolder.get().itemData().appendCustomData(stack, result);

        if (stack.isDamageable()) {
            result.put(
                "durability",
                Map.of(
                    "current", Math.max(0, stack.getMaxDamage() - stack.getDamage()),
                    "max", stack.getMaxDamage(),
                    "damage", stack.getDamage()
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

    public static List<Map<String, Object>> slotsToList(List<Slot> slots, HandledScreen<?> screen) {
        ArrayList<Map<String, Object>> values = new ArrayList<>();
        HandledScreenAccessor accessor = screen instanceof HandledScreenAccessor handledAccessor ? handledAccessor : null;
        for (Slot slot : slots) {
            values.add(slotToMap(slot, accessor));
        }
        return values;
    }

    public static Map<String, Object> slotToMap(Slot slot, HandledScreen<?> screen) {
        HandledScreenAccessor accessor = screen instanceof HandledScreenAccessor handledAccessor ? handledAccessor : null;
        return slotToMap(slot, accessor);
    }

    private static Map<String, Object> slotToMap(Slot slot, HandledScreenAccessor accessor) {
        LinkedHashMap<String, Object> slotMap = new LinkedHashMap<>();
        slotMap.put("slot", slot.id);
        slotMap.put("index", slot.getIndex());
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
        slotMap.put("hasStack", slot.hasStack());
        slotMap.put("item", itemToMap(slot.getStack()));
        return slotMap;
    }

    public static Map<String, Object> entityToMap(Entity entity, ClientPlayerEntity player) {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("id", entity.getId());
        result.put("uuid", entity.getUuidAsString());
        result.put("type", String.valueOf(McRegistries.entityTypeId(entity.getType())));
        result.put("name", entity.getName().getString());
        result.put(
            "pos",
            Map.of(
                "x", entity.getX(),
                "y", entity.getY(),
                "z", entity.getZ()
            )
        );
        result.put("yaw", entity.getYaw());
        result.put("pitch", entity.getPitch());
        result.put("distance", player != null ? player.distanceTo(entity) : 0.0D);
        result.put("alive", entity.isAlive());
        if (entity instanceof LivingEntity livingEntity) {
            result.put("health", livingEntity.getHealth());
            result.put("maxHealth", livingEntity.getMaxHealth());
            result.put("effects", effectsToList(livingEntity.getStatusEffects()));
        }
        return result;
    }

    public static List<Map<String, Object>> effectsToList(Iterable<StatusEffectInstance> effects) {
        ArrayList<Map<String, Object>> values = new ArrayList<>();
        for (StatusEffectInstance effect : effects) {
            values.add(
                Map.of(
                    "id", ClientVersionModulesHolder.get().itemData().statusEffectId(effect),
                    "amplifier", effect.getAmplifier(),
                    "duration", effect.getDuration(),
                    "ambient", effect.isAmbient(),
                    "visible", effect.shouldShowParticles()
                )
            );
        }
        return values;
    }

    public static Map<String, Object> screenToMap(MinecraftClient client) {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        Screen screen = client.currentScreen;
        if (screen == null) {
            result.put("open", false);
            return result;
        }

        result.put("open", true);
        try {
            result.put("type", screen.getClass().getSimpleName());
            Text title = screen.getTitle();
            result.put("title", title != null ? title.getString() : "");
            result.put("width", screen.width);
            result.put("height", screen.height);

            if (screen instanceof HandledScreen<?> handledScreen) {
                ScreenHandler handler = handledScreen.getScreenHandler();
                HandledScreenAccessor accessor = (HandledScreenAccessor) handledScreen;
                result.put("syncId", handler != null ? handler.syncId : -1);
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
                    Map.of(
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

    public static Map<String, Object> playerListEntryToMap(PlayerListEntry entry, Text displayName, Team team) {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("name", entry.getProfile().getName());
        result.put("displayName", displayName != null ? displayName.getString() : entry.getProfile().getName());
        result.put("latency", entry.getLatency());
        result.put("gameMode", entry.getGameMode().getName());
        if (team != null) {
            result.put("team", team.getName());
            result.put("prefix", team.getPrefix().getString());
            result.put("suffix", team.getSuffix().getString());
        }
        return result;
    }
}
