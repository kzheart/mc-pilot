package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.*;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.core.util.ClientDataHelper;
import com.mct.version.ClientVersionModulesHolder;
import com.mct.version.McRegistries;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.ingame.HandledScreen;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ClientPlayerInteractionManager;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.util.ScreenshotRecorder;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.network.packet.c2s.play.PlayerActionC2SPacket;
import net.minecraft.network.packet.c2s.play.UpdateSelectedSlotC2SPacket;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.slot.SlotActionType;
import net.minecraft.text.Text;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import org.jetbrains.annotations.Nullable;

public final class GuiInventoryHandler extends ActionHandler {

    private static final double DEFAULT_WAIT_TIMEOUT_SECONDS = 10.0D;

    public GuiInventoryHandler(MinecraftClient client, ClientStateTracker stateTracker) {
        super(client, stateTracker);
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
            case "inventory.get" -> runOnClientThread(() -> Map.of("slots", ClientDataHelper.slotsToList(requirePlayer().playerScreenHandler.slots)));
            case "inventory.slot" -> runOnClientThread(() -> inventorySlot(params));
            case "inventory.held" -> runOnClientThread(() -> Map.of("item", ClientDataHelper.itemToMap(requirePlayer().getMainHandStack())));
            case "inventory.hotbar" -> runOnClientThread(() -> setHotbar(params));
            case "inventory.drop" -> runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                boolean dropped = player.dropSelectedItem(getBoolean(params, "all", false));
                return Map.of("dropped", dropped, "item", ClientDataHelper.itemToMap(player.getMainHandStack()));
            });
            case "inventory.use" -> runOnClientThread(this::useHeldItem);
            case "inventory.swap-hands" -> swapHands();
            case "gui.info" -> runOnClientThread(() -> ClientDataHelper.screenToMap(client));
            case "gui.snapshot" -> runOnClientThread(this::guiSnapshot);
            case "gui.slot" -> runOnClientThread(() -> guiSlot(params));
            case "gui.click" -> runOnClientThread(() -> guiClick(params));
            case "gui.drag" -> runOnClientThread(() -> guiDrag(params));
            case "gui.close" -> runOnClientThread(this::closeGui);
            case "gui.wait-open" -> waitForGuiOpen(params);
            case "gui.wait-update" -> waitForGuiUpdate(params);
            case "gui.screenshot" -> captureScreenshot(getString(params, "output"), null, true);
            case "capture.screenshot" -> captureScreenshot(getString(params, "output"), getOptionalString(params, "region"), getBoolean(params, "gui", false));
            default -> throw new ActionException("INVALID_ACTION");
        };
    }

    private Map<String, Object> inventorySlot(Map<String, Object> params) {
        int slot = getInt(params, "slot");
        ClientPlayerEntity player = requirePlayer();
        if (slot < 0 || slot >= player.getInventory().size()) {
            throw new ActionException("INVALID_PARAMS");
        }
        return Map.of("slot", slot, "item", ClientDataHelper.itemToMap(player.getInventory().getStack(slot)));
    }

    private Map<String, Object> setHotbar(Map<String, Object> params) {
        int slot = getInt(params, "slot");
        if (slot < 0 || slot > 8) {
            throw new ActionException("INVALID_PARAMS");
        }
        ClientPlayerEntity player = requirePlayer();
        player.getInventory().selectedSlot = slot;
        player.networkHandler.sendPacket(new UpdateSelectedSlotC2SPacket(slot));
        return Map.of("selectedSlot", slot, "item", ClientDataHelper.itemToMap(player.getMainHandStack()));
    }

    private Map<String, Object> useHeldItem() {
        ClientPlayerEntity player = requirePlayer();
        ActionResult result = ClientVersionModulesHolder.get().interaction().interactItem(requireInteractionManager(), player, Hand.MAIN_HAND);
        return Map.of(
            "success", result.isAccepted(),
            "action", ClientVersionModulesHolder.get().actionResult().resultName(result),
            "item", ClientDataHelper.itemToMap(player.getMainHandStack())
        );
    }

    private Map<String, Object> swapHands() {
        ItemStack[] previous = runOnClientThread(() -> new ItemStack[] {
            requirePlayer().getMainHandStack().copy(),
            requirePlayer().getOffHandStack().copy()
        });

        runOnClientThread(() -> {
            ClientPlayerEntity player = requirePlayer();
            player.networkHandler.sendPacket(
                new PlayerActionC2SPacket(PlayerActionC2SPacket.Action.SWAP_ITEM_WITH_OFFHAND, BlockPos.ORIGIN, Direction.DOWN)
            );
            return true;
        });

        LinkedHashMap<String, Object> result = pollOnClientThread(
            2.0D,
            () -> {
                ClientPlayerEntity player = requirePlayer();
                LinkedHashMap<String, Object> state = new LinkedHashMap<>();
                state.put("mainHand", ClientDataHelper.itemToMap(player.getMainHandStack()));
                state.put("offHand", ClientDataHelper.itemToMap(player.getOffHandStack()));
                state.put(
                    "swapped",
                    ItemStack.areEqual(player.getMainHandStack(), previous[1]) && ItemStack.areEqual(player.getOffHandStack(), previous[0])
                );
                return state;
            },
            state -> Boolean.TRUE.equals(state.get("swapped")),
            "TIMEOUT"
        );
        result.remove("swapped");
        return result;
    }

    private Map<String, Object> guiSnapshot() {
        HandledScreen<?> screen = requireHandledScreen();
        LinkedHashMap<String, Object> result = new LinkedHashMap<>(ClientDataHelper.screenToMap(client));
        result.put("slots", ClientDataHelper.slotsToList(screen.getScreenHandler().slots));
        result.put("cursorItem", ClientDataHelper.itemToMap(screen.getScreenHandler().getCursorStack()));
        return result;
    }

    private Map<String, Object> guiSlot(Map<String, Object> params) {
        HandledScreen<?> screen = requireHandledScreen();
        int slot = getInt(params, "slot");
        ScreenHandler handler = screen.getScreenHandler();
        if (slot < 0 || slot >= handler.slots.size()) {
            throw new ActionException("INVALID_PARAMS");
        }
        return Map.of("slot", slot, "item", ClientDataHelper.itemToMap(handler.getSlot(slot).getStack()));
    }

    private Map<String, Object> guiClick(Map<String, Object> params) {
        ClientPlayerEntity player = requirePlayer();
        HandledScreen<?> screen = requireHandledScreen();
        ScreenHandler handler = screen.getScreenHandler();
        int slot = getInt(params, "slot");
        String buttonName = getString(params, "button", "left");
        if (slot < -999 || slot >= handler.slots.size()) {
            throw new ActionException("INVALID_PARAMS");
        }

        ClickPlan plan = clickPlan(buttonName, getInt(params, "key", 0));
        requireInteractionManager().clickSlot(handler.syncId, slot, plan.button, plan.actionType, player);
        safeSleep(120L);
        return Map.of(
            "success", true,
            "cursorItem", ClientDataHelper.itemToMap(handler.getCursorStack()),
            "slotItem", slot >= 0 ? ClientDataHelper.itemToMap(handler.getSlot(slot).getStack()) : ClientDataHelper.itemToMap(ItemStack.EMPTY)
        );
    }

    private Map<String, Object> guiDrag(Map<String, Object> params) {
        ClientPlayerEntity player = requirePlayer();
        HandledScreen<?> screen = requireHandledScreen();
        ScreenHandler handler = screen.getScreenHandler();
        List<Object> slots = getList(params, "slots");
        int button = "right".equals(getString(params, "button")) ? 1 : 0;
        ClientPlayerInteractionManager interactionManager = requireInteractionManager();

        interactionManager.clickSlot(handler.syncId, -999, ScreenHandler.packQuickCraftData(0, button), SlotActionType.QUICK_CRAFT, player);
        for (Object value : slots) {
            int slot = asInt(value);
            interactionManager.clickSlot(handler.syncId, slot, ScreenHandler.packQuickCraftData(1, button), SlotActionType.QUICK_CRAFT, player);
        }
        interactionManager.clickSlot(handler.syncId, -999, ScreenHandler.packQuickCraftData(2, button), SlotActionType.QUICK_CRAFT, player);
        safeSleep(120L);
        return Map.of("success", true, "cursorItem", ClientDataHelper.itemToMap(handler.getCursorStack()));
    }

    private Map<String, Object> closeGui() {
        if (client.currentScreen != null) {
            client.currentScreen.close();
            client.setScreen(null);
            client.mouse.lockCursor();
        }
        return Map.of("success", true);
    }

    private Map<String, Object> waitForGuiOpen(Map<String, Object> params) {
        double timeoutSeconds = getDouble(params, "timeout", DEFAULT_WAIT_TIMEOUT_SECONDS);
        Map<String, Object> result = pollOnClientThread(
            timeoutSeconds,
            () -> {
                if (client.currentScreen == null) {
                    return Map.of();
                }
                return ClientDataHelper.screenToMap(client);
            },
            map -> !map.isEmpty(),
            "TIMEOUT"
        );
        return Map.of("opened", true, "screen", result);
    }

    private Map<String, Object> waitForGuiUpdate(Map<String, Object> params) {
        double timeoutSeconds = getDouble(params, "timeout", DEFAULT_WAIT_TIMEOUT_SECONDS);
        String initial = runOnClientThread(this::screenFingerprint);
        Map<String, Object> result = pollOnClientThread(
            timeoutSeconds,
            () -> {
                if (client.currentScreen == null) {
                    return Map.of();
                }
                String current = screenFingerprint();
                return !current.equals(initial) ? ClientDataHelper.screenToMap(client) : Map.of();
            },
            map -> !map.isEmpty(),
            "TIMEOUT"
        );
        return Map.of("updated", true, "screen", result);
    }

    private Map<String, Object> captureScreenshot(String output, @Nullable String region, boolean guiOnly) {
        return runOnClientThread(() -> {
            try {
                Path outputPath = Path.of(output).toAbsolutePath();
                if (outputPath.getParent() != null) {
                    Files.createDirectories(outputPath.getParent());
                }
                NativeImage image = ScreenshotRecorder.takeScreenshot(client.getFramebuffer());
                try {
                    NativeImage toWrite = image;
                    if (region != null && !region.isBlank()) {
                        toWrite = cropImage(image, region);
                    }
                    toWrite.writeTo(outputPath);
                    if (toWrite != image) {
                        toWrite.close();
                    }
                } finally {
                    image.close();
                }
                return Map.of(
                    "path", outputPath.toString(),
                    "width", client.getWindow().getScaledWidth(),
                    "height", client.getWindow().getScaledHeight(),
                    "gui", guiOnly
                );
            } catch (IOException exception) {
                throw new ActionException("IO_ERROR");
            }
        });
    }

    private NativeImage cropImage(NativeImage image, String region) {
        String[] parts = region.split(",");
        if (parts.length != 4) {
            throw new ActionException("INVALID_PARAMS");
        }
        int x = Integer.parseInt(parts[0].trim());
        int y = Integer.parseInt(parts[1].trim());
        int width = Integer.parseInt(parts[2].trim());
        int height = Integer.parseInt(parts[3].trim());
        NativeImage cropped = new NativeImage(width, height, false);
        for (int row = 0; row < height; row++) {
            for (int column = 0; column < width; column++) {
                int color = ClientVersionModulesHolder.get().image().getPixel(image, x + column, y + row);
                ClientVersionModulesHolder.get().image().setPixel(cropped, column, row, color);
            }
        }
        return cropped;
    }

    private String screenFingerprint() {
        if (client.currentScreen == null) {
            return "none";
        }
        if (client.currentScreen instanceof HandledScreen<?> handledScreen) {
            StringBuilder builder = new StringBuilder();
            Text title = client.currentScreen.getTitle();
            builder.append(client.currentScreen.getClass().getName()).append('|').append(title != null ? title.getString() : "");
            for (int slot = 0; slot < handledScreen.getScreenHandler().slots.size(); slot++) {
                ItemStack stack = handledScreen.getScreenHandler().getSlot(slot).getStack();
                builder.append('|').append(slot).append(':').append(McRegistries.itemId(stack.getItem())).append('#').append(stack.getCount());
            }
            return builder.toString();
        }
        Text title = client.currentScreen.getTitle();
        return client.currentScreen.getClass().getName() + "|" + (title != null ? title.getString() : "");
    }

    private ClickPlan clickPlan(String buttonName, int key) {
        return switch (buttonName) {
            case "left" -> new ClickPlan(0, SlotActionType.PICKUP);
            case "right" -> new ClickPlan(1, SlotActionType.PICKUP);
            case "shift-left" -> new ClickPlan(0, SlotActionType.QUICK_MOVE);
            case "shift-right" -> new ClickPlan(1, SlotActionType.QUICK_MOVE);
            case "middle" -> new ClickPlan(2, SlotActionType.CLONE);
            case "double" -> new ClickPlan(0, SlotActionType.PICKUP_ALL);
            case "drop" -> new ClickPlan(0, SlotActionType.THROW);
            case "ctrl-drop" -> new ClickPlan(1, SlotActionType.THROW);
            default -> {
                if (buttonName.startsWith("number-")) {
                    int number = Integer.parseInt(buttonName.substring("number-".length()));
                    yield new ClickPlan(number - 1, SlotActionType.SWAP);
                }
                if (key >= 1 && key <= 9) {
                    yield new ClickPlan(key - 1, SlotActionType.SWAP);
                }
                throw new ActionException("INVALID_PARAMS");
            }
        };
    }

    private static final class ClickPlan {
        final int button;
        final SlotActionType actionType;

        ClickPlan(int button, SlotActionType actionType) {
            this.button = button;
            this.actionType = actionType;
        }
    }
}
