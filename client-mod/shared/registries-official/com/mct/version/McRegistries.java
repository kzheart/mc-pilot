package com.mct.version;

import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.Identifier;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;

public final class McRegistries {

    private McRegistries() {}

    private static final Registry<Item> ITEM = BuiltInRegistries.ITEM;
    private static final Registry<Block> BLOCK = BuiltInRegistries.BLOCK;
    private static final Registry<EntityType<?>> ENTITY_TYPE = BuiltInRegistries.ENTITY_TYPE;
    private static final Registry<MobEffect> STATUS_EFFECT = BuiltInRegistries.MOB_EFFECT;
    private static final Registry<MenuType<?>> SCREEN_HANDLER = BuiltInRegistries.MENU;

    public static Identifier itemId(Item item) {
        return ITEM.getKey(item);
    }

    public static Identifier blockId(Block block) {
        return BLOCK.getKey(block);
    }

    public static Identifier entityTypeId(EntityType<?> type) {
        return ENTITY_TYPE.getKey(type);
    }

    public static Identifier statusEffectId(MobEffect effect) {
        return STATUS_EFFECT.getKey(effect);
    }

    public static Identifier screenHandlerId(MenuType<?> type) {
        return SCREEN_HANDLER.getKey(type);
    }
}
