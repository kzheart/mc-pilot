package com.mct.version;

import net.minecraft.block.Block;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.effect.StatusEffect;
import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.screen.ScreenHandlerType;
import net.minecraft.util.Identifier;

public final class McRegistries {

    private McRegistries() {}

    private static final Registry<Item> ITEM = Registries.ITEM;
    private static final Registry<Block> BLOCK = Registries.BLOCK;
    private static final Registry<EntityType<?>> ENTITY_TYPE = Registries.ENTITY_TYPE;
    private static final Registry<StatusEffect> STATUS_EFFECT = Registries.STATUS_EFFECT;
    private static final Registry<ScreenHandlerType<?>> SCREEN_HANDLER = Registries.SCREEN_HANDLER;

    public static Identifier itemId(Item item) {
        return ITEM.getId(item);
    }

    public static Identifier blockId(Block block) {
        return BLOCK.getId(block);
    }

    public static Identifier entityTypeId(EntityType<?> type) {
        return ENTITY_TYPE.getId(type);
    }

    public static Identifier statusEffectId(StatusEffect effect) {
        return STATUS_EFFECT.getId(effect);
    }

    public static Identifier screenHandlerId(ScreenHandlerType<?> type) {
        return SCREEN_HANDLER.getId(type);
    }
}
