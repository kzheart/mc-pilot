package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.getInt;
import static com.mct.core.util.ParamHelper.getRequired;
import static com.mct.core.util.ParamHelper.getString;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.core.util.ClientDataHelper;
import com.mct.version.McRegistries;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ClientPlayerInteractionManager;
import net.minecraft.item.ItemStack;
import net.minecraft.network.packet.c2s.play.RenameItemC2SPacket;
import net.minecraft.network.packet.c2s.play.SelectMerchantTradeC2SPacket;
import net.minecraft.screen.AnvilScreenHandler;
import net.minecraft.screen.CraftingScreenHandler;
import net.minecraft.screen.EnchantmentScreenHandler;
import net.minecraft.screen.MerchantScreenHandler;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.slot.SlotActionType;
import net.minecraft.entity.player.PlayerInventory;

public final class ContainerCraftHandler extends ActionHandler {

    public ContainerCraftHandler(MinecraftClient client, ClientStateTracker stateTracker) {
        super(client, stateTracker);
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
            case "craft.enchant" -> runOnClientThread(() -> enchant(params));
            case "craft.trade" -> runOnClientThread(() -> trade(params));
            case "craft.anvil" -> anvil(params);
            case "craft.craft" -> craft(params);
            default -> throw new ActionException("INVALID_ACTION");
        };
    }

    private Map<String, Object> enchant(Map<String, Object> params) {
        EnchantmentScreenHandler handler = requireScreenHandler(EnchantmentScreenHandler.class);
        int option = getInt(params, "option");
        if (option < 0 || option > 2) {
            throw new ActionException("INVALID_PARAMS");
        }
        requireInteractionManager().clickButton(handler.syncId, option);
        return com.mct.core.util.MctMaps.mapOf("selectedOption", option, "success", true);
    }

    private Map<String, Object> trade(Map<String, Object> params) {
        MerchantScreenHandler handler = requireScreenHandler(MerchantScreenHandler.class);
        int index = getInt(params, "index");
        handler.setRecipeIndex(index);
        handler.switchTo(index);
        requirePlayer().networkHandler.sendPacket(new SelectMerchantTradeC2SPacket(index));
        safeSleep(150L);
        ItemStack preview = handler.getSlot(2).getStack().copy();
        if (preview.isEmpty()) {
            return com.mct.core.util.MctMaps.mapOf("success", false, "index", index, "result", ClientDataHelper.itemToMap(ItemStack.EMPTY));
        }
        requireInteractionManager().clickSlot(handler.syncId, 2, 0, SlotActionType.QUICK_MOVE, requirePlayer());
        safeSleep(120L);
        return com.mct.core.util.MctMaps.mapOf("success", true, "index", index, "result", ClientDataHelper.itemToMap(preview));
    }

    private Map<String, Object> anvil(Map<String, Object> params) {
        int inputSlot = getInt(params, "inputSlot");
        String rename = getString(params, "rename");
        runOnClientThread(() -> {
            AnvilScreenHandler handler = requireScreenHandler(AnvilScreenHandler.class);
            quickMoveSlot(handler, normalizeContainerInputSlot(handler, inputSlot), 0);
            requirePlayer().networkHandler.sendPacket(new RenameItemC2SPacket(rename));
            return true;
        });
        ItemStack preview = pollOnClientThread(
            3.0D,
            () -> {
                AnvilScreenHandler handler = requireScreenHandler(AnvilScreenHandler.class);
                return handler.getSlot(2).getStack().copy();
            },
            stack -> !stack.isEmpty(),
            "TIMEOUT"
        );
        runOnClientThread(() -> {
            AnvilScreenHandler handler = requireScreenHandler(AnvilScreenHandler.class);
            requireInteractionManager().clickSlot(handler.syncId, 2, 0, SlotActionType.QUICK_MOVE, requirePlayer());
            return true;
        });
        safeSleep(120L);
        return com.mct.core.util.MctMaps.mapOf("success", true, "rename", rename, "result", ClientDataHelper.itemToMap(preview));
    }

    private Map<String, Object> craft(Map<String, Object> params) {
        Object recipeValue = getRequired(params, "recipe");
        if (recipeValue instanceof Map<?, ?> recipeMap) {
            Object slotsValue = recipeMap.get("slots");
            if (!(slotsValue instanceof List<?> slots) || slots.size() != 9) {
                throw new ActionException("INVALID_PARAMS");
            }
            List<List<?>> normalizedRows = new ArrayList<>();
            normalizedRows.add(slots.subList(0, 3));
            normalizedRows.add(slots.subList(3, 6));
            normalizedRows.add(slots.subList(6, 9));
            recipeValue = normalizedRows;
        }
        if (!(recipeValue instanceof List<?> rows) || rows.size() != 3) {
            throw new ActionException("INVALID_PARAMS");
        }

        runOnClientThread(() -> {
            CraftingScreenHandler handler = requireScreenHandler(CraftingScreenHandler.class);
            for (int slot = 1; slot <= 9; slot++) {
                if (handler.getSlot(slot).hasStack()) {
                    requireInteractionManager().clickSlot(handler.syncId, slot, 0, SlotActionType.QUICK_MOVE, requirePlayer());
                }
            }
            return true;
        });

        for (int row = 0; row < 3; row++) {
            Object rowValue = rows.get(row);
            if (!(rowValue instanceof List<?> columns) || columns.size() != 3) {
                throw new ActionException("INVALID_PARAMS");
            }
            for (int column = 0; column < 3; column++) {
                Object ingredient = columns.get(column);
                if (ingredient == null) {
                    continue;
                }
                String itemId = normalizeItemId(String.valueOf(ingredient));
                int gridSlot = 1 + row * 3 + column;
                runOnClientThread(() -> {
                    CraftingScreenHandler handler = requireScreenHandler(CraftingScreenHandler.class);
                    int inventorySlot = findCraftingIngredientSlot(handler, itemId);
                    placeSingleItem(handler, inventorySlot, gridSlot);
                    return true;
                });
            }
        }

        ItemStack preview = pollOnClientThread(
            3.0D,
            () -> {
                CraftingScreenHandler handler = requireScreenHandler(CraftingScreenHandler.class);
                return handler.getSlot(0).getStack().copy();
            },
            stack -> !stack.isEmpty(),
            "TIMEOUT"
        );
        runOnClientThread(() -> {
            CraftingScreenHandler handler = requireScreenHandler(CraftingScreenHandler.class);
            requireInteractionManager().clickSlot(handler.syncId, 0, 0, SlotActionType.QUICK_MOVE, requirePlayer());
            return true;
        });
        safeSleep(120L);
        return com.mct.core.util.MctMaps.mapOf("crafted", true, "result", ClientDataHelper.itemToMap(preview));
    }

    private void quickMoveSlot(ScreenHandler handler, int sourceSlot, int targetSlot) {
        requireInteractionManager().clickSlot(handler.syncId, sourceSlot, 0, SlotActionType.PICKUP, requirePlayer());
        requireInteractionManager().clickSlot(handler.syncId, targetSlot, 0, SlotActionType.PICKUP, requirePlayer());
        if (!handler.getCursorStack().isEmpty()) {
            requireInteractionManager().clickSlot(handler.syncId, sourceSlot, 0, SlotActionType.PICKUP, requirePlayer());
        }
    }

    private int findCraftingIngredientSlot(CraftingScreenHandler handler, String itemId) {
        for (int slot = 10; slot < handler.slots.size(); slot++) {
            ItemStack stack = handler.getSlot(slot).getStack();
            if (!stack.isEmpty() && normalizeItemId(String.valueOf(McRegistries.itemId(stack.getItem()))).equals(itemId)) {
                return slot;
            }
        }
        throw new ActionException("ITEM_NOT_FOUND");
    }

    private void placeSingleItem(CraftingScreenHandler handler, int inventorySlot, int gridSlot) {
        ClientPlayerEntity player = requirePlayer();
        ClientPlayerInteractionManager interactionManager = requireInteractionManager();
        interactionManager.clickSlot(handler.syncId, inventorySlot, 0, SlotActionType.PICKUP, player);
        interactionManager.clickSlot(handler.syncId, gridSlot, 1, SlotActionType.PICKUP, player);
        interactionManager.clickSlot(handler.syncId, inventorySlot, 0, SlotActionType.PICKUP, player);
    }

    private int normalizeContainerInputSlot(ScreenHandler handler, int inputSlot) {
        if (inputSlot < 0 || inputSlot >= PlayerInventory.MAIN_SIZE) {
            throw new ActionException("INVALID_PARAMS");
        }
        int containerSlots = handler.slots.size() - PlayerInventory.MAIN_SIZE;
        if (inputSlot < 9) {
            return containerSlots + 27 + inputSlot;
        }
        return containerSlots + (inputSlot - 9);
    }

    private String normalizeItemId(String value) {
        return value.contains(":") ? value : "minecraft:" + value;
    }
}
