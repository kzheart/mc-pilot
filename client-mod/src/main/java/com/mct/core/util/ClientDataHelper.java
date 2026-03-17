package com.mct.core.util;

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
import net.minecraft.nbt.NbtCompound;
import net.minecraft.nbt.NbtElement;
import net.minecraft.nbt.NbtList;
import net.minecraft.registry.Registries;
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
        result.put("type", String.valueOf(Registries.ITEM.getId(stack.getItem())));
        result.put("count", stack.getCount());
        result.put("displayName", stack.getName().getString());

        if (stack.hasNbt()) {
            NbtCompound nbt = stack.getNbt();
            result.put("nbt", nbt != null ? nbt.toString() : null);
        }

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

        NbtList enchantments = stack.getEnchantments();
        if (!enchantments.isEmpty()) {
            ArrayList<Map<String, Object>> values = new ArrayList<>();
            for (NbtElement element : enchantments) {
                if (!(element instanceof NbtCompound compound)) {
                    continue;
                }
                values.add(
                    Map.of(
                        "id", compound.getString("id"),
                        "level", compound.getShort("lvl")
                    )
                );
            }
            result.put("enchantments", values);
        }

        return result;
    }

    public static List<Map<String, Object>> slotsToList(List<Slot> slots) {
        ArrayList<Map<String, Object>> values = new ArrayList<>();
        for (Slot slot : slots) {
            LinkedHashMap<String, Object> slotMap = new LinkedHashMap<>();
            slotMap.put("slot", slot.id);
            slotMap.put("hasStack", slot.hasStack());
            slotMap.put("item", itemToMap(slot.getStack()));
            values.add(slotMap);
        }
        return values;
    }

    public static Map<String, Object> entityToMap(Entity entity, ClientPlayerEntity player) {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("id", entity.getId());
        result.put("uuid", entity.getUuidAsString());
        result.put("type", String.valueOf(Registries.ENTITY_TYPE.getId(entity.getType())));
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
                    "id", String.valueOf(Registries.STATUS_EFFECT.getId(effect.getEffectType())),
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
                result.put("syncId", handler != null ? handler.syncId : -1);
                result.put("size", handler != null ? handler.slots.size() : 0);
                result.put(
                    "handlerType",
                    handler != null && handler.getType() != null ? String.valueOf(Registries.SCREEN_HANDLER.getId(handler.getType())) : "player"
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
        ArrayList<String> lines = new ArrayList<>();
        for (int index = 0; index < 4; index++) {
            lines.add(sign.getText(front).getMessage(index, filtered).getString());
        }
        return lines;
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
