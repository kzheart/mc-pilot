package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.getInt;
import static com.mct.core.util.ParamHelper.getRequired;
import static com.mct.core.util.ParamHelper.getString;

import com.mct.core.network.PacketSender;
import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.core.util.ClientDataHelper;
import com.mct.version.McRegistries;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.network.protocol.game.ServerboundRenameItemPacket;
import net.minecraft.network.protocol.game.ServerboundSelectTradePacket;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.AnvilMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.CraftingMenu;
import net.minecraft.world.inventory.EnchantmentMenu;
import net.minecraft.world.inventory.MerchantMenu;
import net.minecraft.world.item.ItemStack;

public final class ContainerCraftHandler extends ActionHandler {

    public ContainerCraftHandler(Minecraft client, ClientStateTracker stateTracker) {
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
        EnchantmentMenu handler = requireScreenHandler(EnchantmentMenu.class);
        int option = getInt(params, "option");
        if (option < 0 || option > 2) {
            throw new ActionException("INVALID_PARAMS");
        }
        requireInteractionManager().handleInventoryButtonClick(handler.containerId, option);
        return com.mct.core.util.MctMaps.mapOf("selectedOption", option, "success", true);
    }

    private Map<String, Object> trade(Map<String, Object> params) {
        MerchantMenu handler = requireScreenHandler(MerchantMenu.class);
        int index = getInt(params, "index");
        handler.setSelectionHint(index);
        handler.tryMoveItems(index);
        PacketSender.send(requirePlayer().connection, new ServerboundSelectTradePacket(index));
        safeSleep(150L);
        ItemStack preview = handler.getSlot(2).getItem().copy();
        if (preview.isEmpty()) {
            return com.mct.core.util.MctMaps.mapOf("success", false, "index", index, "result", ClientDataHelper.itemToMap(ItemStack.EMPTY));
        }
        requireInteractionManager().handleContainerInput(handler.containerId, 2, 0, ContainerInput.QUICK_MOVE, requirePlayer());
        safeSleep(120L);
        return com.mct.core.util.MctMaps.mapOf("success", true, "index", index, "result", ClientDataHelper.itemToMap(preview));
    }

    private Map<String, Object> anvil(Map<String, Object> params) {
        int inputSlot = getInt(params, "inputSlot");
        String rename = getString(params, "rename");
        runOnClientThread(() -> {
            AnvilMenu handler = requireScreenHandler(AnvilMenu.class);
            quickMoveSlot(handler, normalizeContainerInputSlot(handler, inputSlot), 0);
            PacketSender.send(requirePlayer().connection, new ServerboundRenameItemPacket(rename));
            return true;
        });
        ItemStack preview = pollOnClientThread(
            3.0D,
            () -> {
                AnvilMenu handler = requireScreenHandler(AnvilMenu.class);
                return handler.getSlot(2).getItem().copy();
            },
            stack -> !stack.isEmpty(),
            "TIMEOUT"
        );
        runOnClientThread(() -> {
            AnvilMenu handler = requireScreenHandler(AnvilMenu.class);
            requireInteractionManager().handleContainerInput(handler.containerId, 2, 0, ContainerInput.QUICK_MOVE, requirePlayer());
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
            CraftingMenu handler = requireScreenHandler(CraftingMenu.class);
            for (int slot = 1; slot <= 9; slot++) {
                if (handler.getSlot(slot).hasItem()) {
                    requireInteractionManager().handleContainerInput(handler.containerId, slot, 0, ContainerInput.QUICK_MOVE, requirePlayer());
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
                    CraftingMenu handler = requireScreenHandler(CraftingMenu.class);
                    int inventorySlot = findCraftingIngredientSlot(handler, itemId);
                    placeSingleItem(handler, inventorySlot, gridSlot);
                    return true;
                });
            }
        }

        ItemStack preview = pollOnClientThread(
            3.0D,
            () -> {
                CraftingMenu handler = requireScreenHandler(CraftingMenu.class);
                return handler.getSlot(0).getItem().copy();
            },
            stack -> !stack.isEmpty(),
            "TIMEOUT"
        );
        runOnClientThread(() -> {
            CraftingMenu handler = requireScreenHandler(CraftingMenu.class);
            requireInteractionManager().handleContainerInput(handler.containerId, 0, 0, ContainerInput.QUICK_MOVE, requirePlayer());
            return true;
        });
        safeSleep(120L);
        return com.mct.core.util.MctMaps.mapOf("crafted", true, "result", ClientDataHelper.itemToMap(preview));
    }

    private void quickMoveSlot(AbstractContainerMenu handler, int sourceSlot, int targetSlot) {
        requireInteractionManager().handleContainerInput(handler.containerId, sourceSlot, 0, ContainerInput.PICKUP, requirePlayer());
        requireInteractionManager().handleContainerInput(handler.containerId, targetSlot, 0, ContainerInput.PICKUP, requirePlayer());
        if (!handler.getCarried().isEmpty()) {
            requireInteractionManager().handleContainerInput(handler.containerId, sourceSlot, 0, ContainerInput.PICKUP, requirePlayer());
        }
    }

    private int findCraftingIngredientSlot(CraftingMenu handler, String itemId) {
        for (int slot = 10; slot < handler.slots.size(); slot++) {
            ItemStack stack = handler.getSlot(slot).getItem();
            if (!stack.isEmpty() && normalizeItemId(String.valueOf(McRegistries.itemId(stack.getItem()))).equals(itemId)) {
                return slot;
            }
        }
        throw new ActionException("ITEM_NOT_FOUND");
    }

    private void placeSingleItem(CraftingMenu handler, int inventorySlot, int gridSlot) {
        LocalPlayer player = requirePlayer();
        MultiPlayerGameMode interactionManager = requireInteractionManager();
        interactionManager.handleContainerInput(handler.containerId, inventorySlot, 0, ContainerInput.PICKUP, player);
        interactionManager.handleContainerInput(handler.containerId, gridSlot, 1, ContainerInput.PICKUP, player);
        interactionManager.handleContainerInput(handler.containerId, inventorySlot, 0, ContainerInput.PICKUP, player);
    }

    private int normalizeContainerInputSlot(AbstractContainerMenu handler, int inputSlot) {
        if (inputSlot < 0 || inputSlot >= Inventory.INVENTORY_SIZE) {
            throw new ActionException("INVALID_PARAMS");
        }
        int containerSlots = handler.slots.size() - Inventory.INVENTORY_SIZE;
        if (inputSlot < 9) {
            return containerSlots + 27 + inputSlot;
        }
        return containerSlots + (inputSlot - 9);
    }

    private String normalizeItemId(String value) {
        return value.contains(":") ? value : "minecraft:" + value;
    }
}
