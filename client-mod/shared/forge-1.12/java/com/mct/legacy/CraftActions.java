package com.mct.legacy;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import io.netty.buffer.Unpooled;
import java.util.Map;
import net.minecraft.client.entity.EntityPlayerSP;
import net.minecraft.entity.IMerchant;
import net.minecraft.inventory.ClickType;
import net.minecraft.inventory.Container;
import net.minecraft.inventory.ContainerEnchantment;
import net.minecraft.inventory.ContainerMerchant;
import net.minecraft.inventory.ContainerRepair;
import net.minecraft.inventory.ContainerWorkbench;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.network.PacketBuffer;
import net.minecraft.network.play.client.CPacketCustomPayload;
import net.minecraft.village.MerchantRecipe;
import net.minecraft.village.MerchantRecipeList;

/** craft.craft / craft.anvil / craft.enchant / craft.trade */
public final class CraftActions extends LegacyActions {

    private static final int PLAYER_MAIN_SIZE = 36;

    @Override
    public Map<String, Object> handle(String action, JsonObject params) {
        if ("craft.enchant".equals(action)) {
            return onClient(() -> enchant(params));
        }
        if ("craft.trade".equals(action)) {
            return onClient(() -> trade(params));
        }
        if ("craft.anvil".equals(action)) {
            return anvil(params);
        }
        if ("craft.craft".equals(action)) {
            return craft(params);
        }
        throw new LegacyActionException("INVALID_ACTION");
    }

    private Map<String, Object> enchant(JsonObject params) {
        ContainerEnchantment container = requireContainer(ContainerEnchantment.class);
        int option = Params.requireInt(params, "option");
        if (option < 0 || option > 2) {
            throw new LegacyActionException("INVALID_PARAMS");
        }
        requireController().sendEnchantPacket(container.windowId, option);
        return map("selectedOption", option, "success", true);
    }

    private Map<String, Object> trade(JsonObject params) {
        EntityPlayerSP player = requirePlayer();
        ContainerMerchant container = requireContainer(ContainerMerchant.class);
        int index = Params.requireInt(params, "index");

        container.setCurrentRecipeIndex(index);
        PacketBuffer buffer = new PacketBuffer(Unpooled.buffer());
        buffer.writeInt(index);
        player.connection.sendPacket(new CPacketCustomPayload("MC|TrSel", buffer));

        MerchantRecipe recipe = selectedRecipe(player, index);
        if (recipe != null) {
            placeTradeIngredient(container, recipe.getItemToBuy(), 0);
            if (!recipe.getSecondItemToBuy().isEmpty()) {
                placeTradeIngredient(container, recipe.getSecondItemToBuy(), 1);
            }
        }
        MainThread.sleep(150L);
        ItemStack preview = container.getSlot(2).getStack().copy();
        if (preview.isEmpty()) {
            return map("success", false, "index", index, "result", Data.itemToMap(ItemStack.EMPTY));
        }
        requireController().windowClick(container.windowId, 2, 0, ClickType.QUICK_MOVE, player);
        MainThread.sleep(120L);
        return map("success", true, "index", index, "result", Data.itemToMap(preview));
    }

    private MerchantRecipe selectedRecipe(EntityPlayerSP player, int index) {
        Object screen = client.currentScreen;
        try {
            IMerchant merchant = Reflect.get(screen, screen.getClass(), "merchant", "field_147037_w");
            MerchantRecipeList recipes = merchant.getRecipes(player);
            if (recipes != null && index >= 0 && index < recipes.size()) {
                return recipes.get(index);
            }
        } catch (RuntimeException ignored) {
        }
        return null;
    }

    private void placeTradeIngredient(ContainerMerchant container, ItemStack required, int targetSlot) {
        EntityPlayerSP player = requirePlayer();
        if (!container.getSlot(targetSlot).getStack().isEmpty()) {
            return;
        }
        for (int slot = 3; slot < container.inventorySlots.size(); slot++) {
            ItemStack stack = container.getSlot(slot).getStack();
            if (stack.isEmpty() || stack.getItem() != required.getItem() || stack.getCount() < required.getCount()) {
                continue;
            }
            requireController().windowClick(container.windowId, slot, 0, ClickType.PICKUP, player);
            requireController().windowClick(container.windowId, targetSlot, 0, ClickType.PICKUP, player);
            if (!player.inventory.getItemStack().isEmpty()) {
                requireController().windowClick(container.windowId, slot, 0, ClickType.PICKUP, player);
            }
            return;
        }
    }

    private Map<String, Object> anvil(JsonObject params) {
        int inputSlot = Params.requireInt(params, "inputSlot");
        String rename = Params.string(params, "rename");
        onClient(() -> {
            ContainerRepair container = requireContainer(ContainerRepair.class);
            quickSwapSlot(container, normalizeContainerInputSlot(container, inputSlot), 0);
            PacketBuffer buffer = new PacketBuffer(Unpooled.buffer());
            buffer.writeString(rename);
            requirePlayer().connection.sendPacket(new CPacketCustomPayload("MC|ItemName", buffer));
            return true;
        });
        ItemStack preview = pollOnClient(
            3.0D,
            () -> requireContainer(ContainerRepair.class).getSlot(2).getStack().copy(),
            stack -> !stack.isEmpty(),
            "TIMEOUT"
        );
        onClient(() -> {
            ContainerRepair container = requireContainer(ContainerRepair.class);
            requireController().windowClick(container.windowId, 2, 0, ClickType.QUICK_MOVE, requirePlayer());
            return true;
        });
        MainThread.sleep(120L);
        return map("success", true, "rename", rename, "result", Data.itemToMap(preview));
    }

    private Map<String, Object> craft(JsonObject params) {
        if (!Params.has(params, "recipe")) {
            throw new LegacyActionException("INVALID_PARAMS");
        }
        JsonElement recipeValue = params.get("recipe");
        JsonArray rows;
        if (recipeValue.isJsonObject()) {
            JsonArray slots = Params.array(recipeValue.getAsJsonObject(), "slots");
            if (slots.size() != 9) {
                throw new LegacyActionException("INVALID_PARAMS");
            }
            rows = new JsonArray();
            for (int row = 0; row < 3; row++) {
                JsonArray columns = new JsonArray();
                for (int column = 0; column < 3; column++) {
                    columns.add(slots.get(row * 3 + column));
                }
                rows.add(columns);
            }
        } else if (recipeValue.isJsonArray() && recipeValue.getAsJsonArray().size() == 3) {
            rows = recipeValue.getAsJsonArray();
        } else {
            throw new LegacyActionException("INVALID_PARAMS");
        }

        onClient(() -> {
            ContainerWorkbench container = requireContainer(ContainerWorkbench.class);
            for (int slot = 1; slot <= 9; slot++) {
                if (container.getSlot(slot).getHasStack()) {
                    requireController().windowClick(container.windowId, slot, 0, ClickType.QUICK_MOVE, requirePlayer());
                }
            }
            return true;
        });

        for (int row = 0; row < 3; row++) {
            JsonElement rowValue = rows.get(row);
            if (!rowValue.isJsonArray() || rowValue.getAsJsonArray().size() != 3) {
                throw new LegacyActionException("INVALID_PARAMS");
            }
            for (int column = 0; column < 3; column++) {
                JsonElement ingredient = rowValue.getAsJsonArray().get(column);
                if (ingredient.isJsonNull()) {
                    continue;
                }
                String itemId = Data.normalizeItemId(ingredient.getAsString());
                int gridSlot = 1 + row * 3 + column;
                onClient(() -> {
                    ContainerWorkbench container = requireContainer(ContainerWorkbench.class);
                    int inventorySlot = findIngredientSlot(container, itemId);
                    placeSingleItem(container, inventorySlot, gridSlot);
                    return true;
                });
            }
        }

        ItemStack preview = pollOnClient(
            3.0D,
            () -> requireContainer(ContainerWorkbench.class).getSlot(0).getStack().copy(),
            stack -> !stack.isEmpty(),
            "TIMEOUT"
        );
        onClient(() -> {
            ContainerWorkbench container = requireContainer(ContainerWorkbench.class);
            requireController().windowClick(container.windowId, 0, 0, ClickType.QUICK_MOVE, requirePlayer());
            return true;
        });
        MainThread.sleep(120L);
        return map("crafted", true, "result", Data.itemToMap(preview));
    }

    private void quickSwapSlot(Container container, int sourceSlot, int targetSlot) {
        EntityPlayerSP player = requirePlayer();
        requireController().windowClick(container.windowId, sourceSlot, 0, ClickType.PICKUP, player);
        requireController().windowClick(container.windowId, targetSlot, 0, ClickType.PICKUP, player);
        if (!player.inventory.getItemStack().isEmpty()) {
            requireController().windowClick(container.windowId, sourceSlot, 0, ClickType.PICKUP, player);
        }
    }

    private int findIngredientSlot(ContainerWorkbench container, String itemId) {
        for (int slot = 10; slot < container.inventorySlots.size(); slot++) {
            ItemStack stack = container.getSlot(slot).getStack();
            if (!stack.isEmpty()
                && Data.normalizeItemId(String.valueOf(Item.REGISTRY.getNameForObject(stack.getItem()))).equals(itemId)) {
                return slot;
            }
        }
        throw new LegacyActionException("ITEM_NOT_FOUND");
    }

    private void placeSingleItem(Container container, int inventorySlot, int gridSlot) {
        EntityPlayerSP player = requirePlayer();
        requireController().windowClick(container.windowId, inventorySlot, 0, ClickType.PICKUP, player);
        requireController().windowClick(container.windowId, gridSlot, 1, ClickType.PICKUP, player);
        requireController().windowClick(container.windowId, inventorySlot, 0, ClickType.PICKUP, player);
    }

    private int normalizeContainerInputSlot(Container container, int inputSlot) {
        if (inputSlot < 0 || inputSlot >= PLAYER_MAIN_SIZE) {
            throw new LegacyActionException("INVALID_PARAMS");
        }
        int containerSlots = container.inventorySlots.size() - PLAYER_MAIN_SIZE;
        if (inputSlot < 9) {
            return containerSlots + 27 + inputSlot;
        }
        return containerSlots + (inputSlot - 9);
    }
}
