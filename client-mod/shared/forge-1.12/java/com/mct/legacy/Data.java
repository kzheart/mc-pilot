package com.mct.legacy;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.entity.EntityPlayerSP;
import net.minecraft.client.gui.GuiScreen;
import net.minecraft.client.gui.inventory.GuiContainer;
import net.minecraft.enchantment.Enchantment;
import net.minecraft.enchantment.EnchantmentHelper;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityList;
import net.minecraft.entity.EntityLivingBase;
import net.minecraft.entity.player.EntityPlayer;
import net.minecraft.inventory.Container;
import net.minecraft.inventory.ContainerChest;
import net.minecraft.inventory.ContainerEnchantment;
import net.minecraft.inventory.ContainerFurnace;
import net.minecraft.inventory.ContainerMerchant;
import net.minecraft.inventory.ContainerPlayer;
import net.minecraft.inventory.ContainerRepair;
import net.minecraft.inventory.ContainerWorkbench;
import net.minecraft.inventory.Slot;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.potion.Potion;
import net.minecraft.potion.PotionEffect;
import net.minecraft.util.ResourceLocation;
import net.minecraft.util.text.ITextComponent;

/** Converts game objects to the protocol's data shapes (mirrors ClientDataHelper). */
public final class Data {

    private Data() {
    }

    public static Map<String, Object> itemToMap(ItemStack stack) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        if (stack == null || stack.isEmpty()) {
            result.put("empty", true);
            result.put("type", "minecraft:air");
            result.put("count", 0);
            return result;
        }
        result.put("empty", false);
        result.put("type", String.valueOf(Item.REGISTRY.getNameForObject(stack.getItem())));
        result.put("count", stack.getCount());
        result.put("displayName", stack.getDisplayName());
        if (stack.getItemDamage() != 0 && !stack.isItemStackDamageable()) {
            result.put("damage", stack.getItemDamage());
        }
        if (stack.isItemStackDamageable()) {
            Map<String, Object> durability = new LinkedHashMap<String, Object>();
            durability.put("current", Math.max(0, stack.getMaxDamage() - stack.getItemDamage()));
            durability.put("max", stack.getMaxDamage());
            durability.put("damage", stack.getItemDamage());
            result.put("durability", durability);
        }
        Map<Enchantment, Integer> enchantments = EnchantmentHelper.getEnchantments(stack);
        if (!enchantments.isEmpty()) {
            List<Map<String, Object>> values = new ArrayList<Map<String, Object>>();
            for (Map.Entry<Enchantment, Integer> entry : enchantments.entrySet()) {
                Map<String, Object> enchantment = new LinkedHashMap<String, Object>();
                ResourceLocation id = Enchantment.REGISTRY.getNameForObject(entry.getKey());
                enchantment.put("id", String.valueOf(id));
                enchantment.put("level", entry.getValue());
                values.add(enchantment);
            }
            result.put("enchantments", values);
        }
        return result;
    }

    public static List<Map<String, Object>> effectsToList(Iterable<PotionEffect> effects) {
        List<Map<String, Object>> values = new ArrayList<Map<String, Object>>();
        for (PotionEffect effect : effects) {
            Map<String, Object> value = new LinkedHashMap<String, Object>();
            value.put("id", String.valueOf(Potion.REGISTRY.getNameForObject(effect.getPotion())));
            value.put("amplifier", effect.getAmplifier());
            value.put("duration", effect.getDuration());
            value.put("ambient", effect.getIsAmbient());
            value.put("visible", effect.doesShowParticles());
            values.add(value);
        }
        return values;
    }

    public static String entityTypeId(Entity entity) {
        if (entity instanceof EntityPlayer) {
            return "minecraft:player";
        }
        ResourceLocation key = EntityList.getKey(entity);
        return key != null ? key.toString() : "minecraft:unknown";
    }

    public static Map<String, Object> entityToMap(Entity entity, EntityPlayerSP player) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("id", entity.getEntityId());
        result.put("uuid", entity.getUniqueID().toString());
        result.put("type", entityTypeId(entity));
        result.put("name", entity.getName());
        Map<String, Object> pos = new LinkedHashMap<String, Object>();
        pos.put("x", entity.posX);
        pos.put("y", entity.posY);
        pos.put("z", entity.posZ);
        result.put("pos", pos);
        result.put("yaw", entity.rotationYaw);
        result.put("pitch", entity.rotationPitch);
        result.put("distance", player != null ? (double) player.getDistance(entity) : 0.0D);
        result.put("alive", entity.isEntityAlive());
        if (entity instanceof EntityLivingBase) {
            EntityLivingBase living = (EntityLivingBase) entity;
            result.put("health", living.getHealth());
            result.put("maxHealth", living.getMaxHealth());
            result.put("effects", effectsToList(living.getActivePotionEffects()));
        }
        return result;
    }

    public static Map<String, Object> slotToMap(Slot slot, GuiContainer screen) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("slot", slot.slotNumber);
        result.put("index", slot.getSlotIndex());
        result.put("localX", slot.xPos);
        result.put("localY", slot.yPos);
        result.put("width", 18);
        result.put("height", 18);
        if (screen != null) {
            int screenX = guiLeft(screen) + slot.xPos;
            int screenY = guiTop(screen) + slot.yPos;
            result.put("screenX", screenX);
            result.put("screenY", screenY);
            result.put("centerX", screenX + 8);
            result.put("centerY", screenY + 8);
        }
        result.put("hasStack", slot.getHasStack());
        result.put("item", itemToMap(slot.getStack()));
        return result;
    }

    public static List<Map<String, Object>> slotsToList(List<Slot> slots, GuiContainer screen) {
        List<Map<String, Object>> values = new ArrayList<Map<String, Object>>();
        for (Slot slot : slots) {
            values.add(slotToMap(slot, screen));
        }
        return values;
    }

    public static int guiLeft(GuiContainer screen) {
        Object value = Reflect.get(screen, GuiContainer.class, "guiLeft", "field_147003_i");
        return ((Number) value).intValue();
    }

    public static int guiTop(GuiContainer screen) {
        Object value = Reflect.get(screen, GuiContainer.class, "guiTop", "field_147009_r");
        return ((Number) value).intValue();
    }

    public static int guiWidth(GuiContainer screen) {
        Object value = Reflect.get(screen, GuiContainer.class, "xSize", "field_146999_f");
        return ((Number) value).intValue();
    }

    public static int guiHeight(GuiContainer screen) {
        Object value = Reflect.get(screen, GuiContainer.class, "ySize", "field_147000_g");
        return ((Number) value).intValue();
    }

    public static String screenTitle(GuiScreen screen) {
        if (screen instanceof GuiContainer) {
            Container container = ((GuiContainer) screen).inventorySlots;
            if (container instanceof ContainerChest) {
                return ((ContainerChest) container).getLowerChestInventory().getDisplayName().getUnformattedText();
            }
        }
        String reason = disconnectReasonOf(screen);
        return reason != null ? reason : "";
    }

    public static String handlerType(Container container) {
        if (container instanceof ContainerPlayer) {
            return "player";
        }
        if (container instanceof ContainerChest) {
            int rows = (container.inventorySlots.size() - 36) / 9;
            return "minecraft:generic_9x" + rows;
        }
        if (container instanceof ContainerWorkbench) {
            return "minecraft:crafting";
        }
        if (container instanceof ContainerFurnace) {
            return "minecraft:furnace";
        }
        if (container instanceof ContainerEnchantment) {
            return "minecraft:enchantment";
        }
        if (container instanceof ContainerRepair) {
            return "minecraft:anvil";
        }
        if (container instanceof ContainerMerchant) {
            return "minecraft:merchant";
        }
        return container.getClass().getSimpleName();
    }

    public static Map<String, Object> screenToMap(Minecraft client) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        GuiScreen screen = client.currentScreen;
        if (screen == null) {
            result.put("open", false);
            return result;
        }
        result.put("open", true);
        result.put("type", screen.getClass().getSimpleName());
        result.put("title", screenTitle(screen));
        result.put("category", screenCategory(client));
        result.put("disconnectReason", disconnectReason(client));
        result.put("width", screen.width);
        result.put("height", screen.height);
        if (screen instanceof GuiContainer) {
            GuiContainer containerScreen = (GuiContainer) screen;
            Container container = containerScreen.inventorySlots;
            result.put("syncId", container != null ? container.windowId : -1);
            result.put("size", container != null ? container.inventorySlots.size() : 0);
            int left = guiLeft(containerScreen);
            int top = guiTop(containerScreen);
            int width = guiWidth(containerScreen);
            int height = guiHeight(containerScreen);
            result.put("guiLeft", left);
            result.put("guiTop", top);
            result.put("backgroundWidth", width);
            result.put("backgroundHeight", height);
            Map<String, Object> bounds = new LinkedHashMap<String, Object>();
            bounds.put("x", left);
            bounds.put("y", top);
            bounds.put("width", width);
            bounds.put("height", height);
            result.put("bounds", bounds);
            result.put("handlerType", container != null ? handlerType(container) : "player");
        } else {
            result.put("syncId", -1);
            result.put("size", 0);
        }
        return result;
    }

    public static String screenCategory(Minecraft client) {
        GuiScreen screen = client.currentScreen;
        if (screen == null) {
            return "game";
        }
        String className = screen.getClass().getName();
        if (isDisconnectLike(screen)) {
            return "disconnected";
        }
        if (className.contains("GuiMainMenu")) {
            return "title";
        }
        if (className.contains("GuiMultiplayer")) {
            return "multiplayer";
        }
        return "screen";
    }

    public static String disconnectReason(Minecraft client) {
        GuiScreen screen = client.currentScreen;
        if (screen == null || !isDisconnectLike(screen)) {
            return "";
        }
        String reason = disconnectReasonOf(screen);
        return reason != null ? reason : "";
    }

    private static boolean isDisconnectLike(GuiScreen screen) {
        return screen.getClass().getName().contains("GuiDisconnected");
    }

    private static String disconnectReasonOf(GuiScreen screen) {
        if (!isDisconnectLike(screen)) {
            return null;
        }
        try {
            Object message = Reflect.get(screen, screen.getClass(), "message", "field_146304_f");
            if (message instanceof ITextComponent) {
                return ((ITextComponent) message).getUnformattedText();
            }
        } catch (RuntimeException ignored) {
        }
        return "";
    }

    public static String normalizeItemId(String value) {
        return value.contains(":") ? value : "minecraft:" + value;
    }

    public static String normalizeEntityType(String value) {
        String normalized = value.contains(":") ? value : "minecraft:" + value;
        return normalized.toLowerCase(Locale.ROOT);
    }
}
