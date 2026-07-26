package com.mct.legacy;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.imageio.ImageIO;
import net.minecraft.client.entity.EntityPlayerSP;
import net.minecraft.client.gui.ScaledResolution;
import net.minecraft.client.gui.inventory.GuiContainer;
import net.minecraft.inventory.ClickType;
import net.minecraft.inventory.Container;
import net.minecraft.item.ItemStack;
import net.minecraft.network.play.client.CPacketHeldItemChange;
import net.minecraft.network.play.client.CPacketPlayerDigging;
import net.minecraft.util.EnumActionResult;
import net.minecraft.util.EnumFacing;
import net.minecraft.util.EnumHand;
import net.minecraft.util.ScreenShotHelper;
import net.minecraft.util.math.BlockPos;

/** inventory.* / gui.* / capture.screenshot */
public final class InventoryGuiActions extends LegacyActions {

    private static final double DEFAULT_WAIT_TIMEOUT_SECONDS = 10.0D;

    @Override
    public Map<String, Object> handle(String action, JsonObject params) {
        if ("inventory.get".equals(action)) {
            return waitForCondition(
                params,
                () -> map("slots", Data.slotsToList(requirePlayer().inventoryContainer.inventorySlots, null)),
                result -> slotsConditionMatches(params, result.get("slots"))
            );
        }
        if ("inventory.slot".equals(action)) {
            return waitForCondition(
                params,
                () -> inventorySlot(params),
                result -> itemConditionMatches(params, result.get("item"))
            );
        }
        if ("inventory.held".equals(action)) {
            return waitForCondition(
                params,
                () -> map("item", Data.itemToMap(requirePlayer().getHeldItemMainhand())),
                result -> itemConditionMatches(params, result.get("item"))
            );
        }
        if ("inventory.hotbar".equals(action)) {
            return onClient(() -> setHotbar(params));
        }
        if ("inventory.drop".equals(action)) {
            return onClient(() -> {
                EntityPlayerSP player = requirePlayer();
                boolean hadItem = !player.getHeldItemMainhand().isEmpty();
                if (hadItem) {
                    // Must go through the digging packet so the server performs the drop.
                    player.connection.sendPacket(new CPacketPlayerDigging(
                        Params.booleanValue(params, "all", false)
                            ? CPacketPlayerDigging.Action.DROP_ALL_ITEMS
                            : CPacketPlayerDigging.Action.DROP_ITEM,
                        BlockPos.ORIGIN, EnumFacing.DOWN
                    ));
                }
                return map("dropped", hadItem, "item", Data.itemToMap(player.getHeldItemMainhand()));
            });
        }
        if ("inventory.use".equals(action)) {
            return onClient(() -> {
                EntityPlayerSP player = requirePlayer();
                EnumActionResult result = requireController().processRightClick(player, client.world, EnumHand.MAIN_HAND);
                return map(
                    "success", result == EnumActionResult.SUCCESS,
                    "action", result.name(),
                    "item", Data.itemToMap(player.getHeldItemMainhand())
                );
            });
        }
        if ("inventory.swap-hands".equals(action)) {
            return swapHands();
        }
        if ("gui.info".equals(action)) {
            return onClient(() -> Data.screenToMap(client));
        }
        if ("gui.layout".equals(action)) {
            return onClient(this::guiLayout);
        }
        if ("gui.snapshot".equals(action)) {
            return onClient(this::guiSnapshot);
        }
        if ("gui.slot".equals(action)) {
            return onClient(() -> guiSlot(params));
        }
        if ("gui.click".equals(action)) {
            return onClient(() -> guiClick(params));
        }
        if ("gui.drag".equals(action)) {
            return onClient(() -> guiDrag(params));
        }
        if ("gui.close".equals(action)) {
            return onClient(this::closeGui);
        }
        if ("gui.wait-open".equals(action)) {
            return waitForGuiOpen(params);
        }
        if ("gui.wait-update".equals(action)) {
            return waitForGuiUpdate(params);
        }
        if ("gui.screenshot".equals(action)) {
            return captureScreenshot(Params.requireString(params, "output"), null, true);
        }
        if ("capture.screenshot".equals(action)) {
            String region = Params.has(params, "region") ? Params.string(params, "region") : null;
            return captureScreenshot(Params.requireString(params, "output"), region, Params.booleanValue(params, "gui", false));
        }
        throw new LegacyActionException("INVALID_ACTION");
    }

    private Map<String, Object> inventorySlot(JsonObject params) {
        int slot = Params.requireInt(params, "slot");
        EntityPlayerSP player = requirePlayer();
        if (slot < 0 || slot >= player.inventory.getSizeInventory()) {
            throw new LegacyActionException("INVALID_PARAMS");
        }
        return map("slot", slot, "item", Data.itemToMap(player.inventory.getStackInSlot(slot)));
    }

    private Map<String, Object> setHotbar(JsonObject params) {
        int slot = Params.requireInt(params, "slot");
        if (slot < 0 || slot > 8) {
            throw new LegacyActionException("INVALID_PARAMS");
        }
        EntityPlayerSP player = requirePlayer();
        player.inventory.currentItem = slot;
        player.connection.sendPacket(new CPacketHeldItemChange(slot));
        return map("selectedSlot", slot, "item", Data.itemToMap(player.getHeldItemMainhand()));
    }

    private Map<String, Object> swapHands() {
        ItemStack[] previous = onClient(() -> {
            EntityPlayerSP player = requirePlayer();
            return new ItemStack[] {player.getHeldItemMainhand().copy(), player.getHeldItemOffhand().copy()};
        });
        onClient(() -> {
            EntityPlayerSP player = requirePlayer();
            player.connection.sendPacket(new CPacketPlayerDigging(
                CPacketPlayerDigging.Action.SWAP_HELD_ITEMS, BlockPos.ORIGIN, EnumFacing.DOWN
            ));
            return true;
        });
        Map<String, Object> result = pollOnClient(
            2.0D,
            () -> {
                EntityPlayerSP player = requirePlayer();
                Map<String, Object> state = new LinkedHashMap<String, Object>();
                state.put("mainHand", Data.itemToMap(player.getHeldItemMainhand()));
                state.put("offHand", Data.itemToMap(player.getHeldItemOffhand()));
                state.put(
                    "swapped",
                    ItemStack.areItemStacksEqual(player.getHeldItemMainhand(), previous[1])
                        && ItemStack.areItemStacksEqual(player.getHeldItemOffhand(), previous[0])
                );
                return state;
            },
            state -> Boolean.TRUE.equals(state.get("swapped")),
            "TIMEOUT"
        );
        result.remove("swapped");
        return result;
    }

    private boolean slotsConditionMatches(JsonObject params, Object slots) {
        if (!hasItemCondition(params)) {
            return true;
        }
        for (Object slot : (Iterable<?>) slots) {
            if (slot instanceof Map && itemConditionMatches(params, ((Map<?, ?>) slot).get("item"))) {
                return true;
            }
        }
        return false;
    }

    private boolean itemConditionMatches(JsonObject params, Object item) {
        if (!hasItemCondition(params)) {
            return true;
        }
        if (!(item instanceof Map)) {
            return false;
        }
        Object rawType = ((Map<?, ?>) item).get("type");
        String itemType = rawType == null ? "" : String.valueOf(rawType);
        String expectedType = Params.has(params, "type") ? Params.string(params, "type") : null;
        if (expectedType != null && !expectedType.equals(itemType)) {
            return false;
        }
        String excludedType = Params.has(params, "notType") ? Params.string(params, "notType") : null;
        return excludedType == null || !excludedType.equals(itemType);
    }

    private boolean hasItemCondition(JsonObject params) {
        return Params.has(params, "type") || Params.has(params, "notType");
    }

    private Map<String, Object> guiSnapshot() {
        GuiContainer screen = requireContainerScreen();
        Map<String, Object> result = new LinkedHashMap<String, Object>(Data.screenToMap(client));
        result.put("slots", Data.slotsToList(screen.inventorySlots.inventorySlots, screen));
        result.put("cursorItem", Data.itemToMap(requirePlayer().inventory.getItemStack()));
        return result;
    }

    private Map<String, Object> guiLayout() {
        GuiContainer screen = requireContainerScreen();
        ScaledResolution resolution = new ScaledResolution(client);
        Map<String, Object> result = new LinkedHashMap<String, Object>(Data.screenToMap(client));
        result.put("slots", Data.slotsToList(screen.inventorySlots.inventorySlots, screen));
        result.put("scaledWidth", resolution.getScaledWidth());
        result.put("scaledHeight", resolution.getScaledHeight());
        result.put("framebufferWidth", client.displayWidth);
        result.put("framebufferHeight", client.displayHeight);
        result.put("scaleFactor", resolution.getScaleFactor());
        return result;
    }

    private Map<String, Object> guiSlot(JsonObject params) {
        GuiContainer screen = requireContainerScreen();
        int slot = Params.requireInt(params, "slot");
        Container container = screen.inventorySlots;
        if (slot < 0 || slot >= container.inventorySlots.size()) {
            throw new LegacyActionException("INVALID_PARAMS");
        }
        return Data.slotToMap(container.getSlot(slot), screen);
    }

    private Map<String, Object> guiClick(JsonObject params) {
        EntityPlayerSP player = requirePlayer();
        GuiContainer screen = requireContainerScreen();
        Container container = screen.inventorySlots;
        int slot = Params.requireInt(params, "slot");
        String buttonName = Params.string(params, "button", "left");
        if (slot < -999 || slot >= container.inventorySlots.size()) {
            throw new LegacyActionException("INVALID_PARAMS");
        }
        int[] plan = clickPlan(buttonName, Params.intValue(params, "key", 0));
        requireController().windowClick(container.windowId, slot, plan[0], ClickType.values()[plan[1]], player);
        MainThread.sleep(120L);
        return map(
            "success", true,
            "cursorItem", Data.itemToMap(player.inventory.getItemStack()),
            "slotItem", slot >= 0 ? Data.itemToMap(container.getSlot(slot).getStack()) : Data.itemToMap(ItemStack.EMPTY)
        );
    }

    private Map<String, Object> guiDrag(JsonObject params) {
        EntityPlayerSP player = requirePlayer();
        GuiContainer screen = requireContainerScreen();
        Container container = screen.inventorySlots;
        JsonArray slots = Params.array(params, "slots");
        int button = "right".equals(Params.string(params, "button")) ? 1 : 0;

        requireController().windowClick(container.windowId, -999, Container.getQuickcraftMask(0, button), ClickType.QUICK_CRAFT, player);
        for (int index = 0; index < slots.size(); index++) {
            int slot = slots.get(index).getAsInt();
            requireController().windowClick(container.windowId, slot, Container.getQuickcraftMask(1, button), ClickType.QUICK_CRAFT, player);
        }
        requireController().windowClick(container.windowId, -999, Container.getQuickcraftMask(2, button), ClickType.QUICK_CRAFT, player);
        MainThread.sleep(120L);
        return map("success", true, "cursorItem", Data.itemToMap(player.inventory.getItemStack()));
    }

    private Map<String, Object> closeGui() {
        if (client.currentScreen != null) {
            EntityPlayerSP player = client.player;
            if (player != null) {
                player.closeScreen();
            } else {
                client.displayGuiScreen(null);
            }
            client.setIngameFocus();
        }
        return map("success", true);
    }

    private Map<String, Object> waitForGuiOpen(JsonObject params) {
        double timeoutSeconds = Params.doubleValue(params, "timeout", DEFAULT_WAIT_TIMEOUT_SECONDS);
        Map<String, Object> result = pollOnClient(
            timeoutSeconds,
            () -> client.currentScreen == null ? map() : Data.screenToMap(client),
            screenMap -> !screenMap.isEmpty(),
            "TIMEOUT"
        );
        return map("opened", true, "screen", result);
    }

    private Map<String, Object> waitForGuiUpdate(JsonObject params) {
        double timeoutSeconds = Params.doubleValue(params, "timeout", DEFAULT_WAIT_TIMEOUT_SECONDS);
        String initial = onClient(this::screenFingerprint);
        Map<String, Object> result = pollOnClient(
            timeoutSeconds,
            () -> {
                if (client.currentScreen == null) {
                    return map();
                }
                String current = screenFingerprint();
                return !current.equals(initial) ? Data.screenToMap(client) : map();
            },
            screenMap -> !screenMap.isEmpty(),
            "TIMEOUT"
        );
        return map("updated", true, "screen", result);
    }

    private String screenFingerprint() {
        if (client.currentScreen == null) {
            return "none";
        }
        StringBuilder builder = new StringBuilder();
        builder.append(client.currentScreen.getClass().getName()).append('|').append(Data.screenTitle(client.currentScreen));
        if (client.currentScreen instanceof GuiContainer) {
            Container container = ((GuiContainer) client.currentScreen).inventorySlots;
            List<net.minecraft.inventory.Slot> slots = container.inventorySlots;
            for (int index = 0; index < slots.size(); index++) {
                ItemStack stack = slots.get(index).getStack();
                builder.append('|').append(index).append(':')
                    .append(stack.isEmpty() ? "air" : String.valueOf(net.minecraft.item.Item.REGISTRY.getNameForObject(stack.getItem())))
                    .append('#').append(stack.getCount());
            }
        }
        return builder.toString();
    }

    private Map<String, Object> captureScreenshot(String output, String region, boolean guiOnly) {
        try {
            File outputFile = new File(output).getAbsoluteFile();
            if (outputFile.getParentFile() != null) {
                outputFile.getParentFile().mkdirs();
            }
            BufferedImage image = onClient(() ->
                ScreenShotHelper.createScreenshot(client.displayWidth, client.displayHeight, client.getFramebuffer())
            );
            if (region != null && !region.trim().isEmpty()) {
                String[] parts = region.split(",");
                if (parts.length != 4) {
                    throw new LegacyActionException("INVALID_PARAMS");
                }
                image = image.getSubimage(
                    Integer.parseInt(parts[0].trim()),
                    Integer.parseInt(parts[1].trim()),
                    Integer.parseInt(parts[2].trim()),
                    Integer.parseInt(parts[3].trim())
                );
            }
            ImageIO.write(image, "png", outputFile);
            ScaledResolution resolution = onClient(() -> new ScaledResolution(client));
            return map(
                "path", outputFile.getPath(),
                "width", resolution.getScaledWidth(),
                "height", resolution.getScaledHeight(),
                "gui", guiOnly
            );
        } catch (LegacyActionException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new LegacyActionException("IO_ERROR");
        }
    }

    /** @return [mouseButton, ClickType.ordinal] — PICKUP,QUICK_MOVE,SWAP,CLONE,THROW,QUICK_CRAFT,PICKUP_ALL */
    private int[] clickPlan(String buttonName, int key) {
        if ("left".equals(buttonName)) {
            return new int[] {0, ClickType.PICKUP.ordinal()};
        }
        if ("right".equals(buttonName)) {
            return new int[] {1, ClickType.PICKUP.ordinal()};
        }
        if ("shift-left".equals(buttonName)) {
            return new int[] {0, ClickType.QUICK_MOVE.ordinal()};
        }
        if ("shift-right".equals(buttonName)) {
            return new int[] {1, ClickType.QUICK_MOVE.ordinal()};
        }
        if ("middle".equals(buttonName)) {
            return new int[] {2, ClickType.CLONE.ordinal()};
        }
        if ("double".equals(buttonName)) {
            return new int[] {0, ClickType.PICKUP_ALL.ordinal()};
        }
        if ("drop".equals(buttonName)) {
            return new int[] {0, ClickType.THROW.ordinal()};
        }
        if ("ctrl-drop".equals(buttonName)) {
            return new int[] {1, ClickType.THROW.ordinal()};
        }
        if (buttonName.startsWith("number-")) {
            int number = Integer.parseInt(buttonName.substring("number-".length()));
            return new int[] {number - 1, ClickType.SWAP.ordinal()};
        }
        if (key >= 1 && key <= 9) {
            return new int[] {key - 1, ClickType.SWAP.ordinal()};
        }
        throw new LegacyActionException("INVALID_PARAMS");
    }
}
