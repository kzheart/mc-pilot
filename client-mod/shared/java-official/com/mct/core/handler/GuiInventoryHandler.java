package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.*;

import com.mct.core.network.PacketSender;
import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.core.util.ClientDataHelper;
import com.mct.version.ClientVersionModulesHolder;
import com.mct.version.McRegistries;
import com.mojang.blaze3d.platform.NativeImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ServerboundPlayerActionPacket;
import net.minecraft.network.protocol.game.ServerboundSetCarriedItemPacket;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.item.ItemStack;
import org.jetbrains.annotations.Nullable;

public final class GuiInventoryHandler extends ActionHandler {

    private static final double DEFAULT_WAIT_TIMEOUT_SECONDS = 10.0D;
    private static final long SCREENSHOT_TIMEOUT_SECONDS = 10L;

    public GuiInventoryHandler(Minecraft client, ClientStateTracker stateTracker) {
        super(client, stateTracker);
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
            case "inventory.get" -> inventoryGet(params);
            case "inventory.slot" -> waitForCondition(params, () -> inventorySlot(params), result -> itemConditionMatches(params, result.get("item")));
            case "inventory.held" -> inventoryHeld(params);
            case "inventory.hotbar" -> runOnClientThread(() -> setHotbar(params));
            case "inventory.drop" -> runOnClientThread(() -> {
                LocalPlayer player = requirePlayer();
                boolean dropped = player.drop(getBoolean(params, "all", false));
                return com.mct.core.util.MctMaps.mapOf("dropped", dropped, "item", ClientDataHelper.itemToMap(player.getMainHandItem()));
            });
            case "inventory.use" -> runOnClientThread(this::useHeldItem);
            case "inventory.swap-hands" -> swapHands();
            case "gui.info" -> runOnClientThread(() -> ClientDataHelper.screenToMap(client));
            case "gui.layout" -> runOnClientThread(this::guiLayout);
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
        LocalPlayer player = requirePlayer();
        if (slot < 0 || slot >= player.getInventory().getContainerSize()) {
            throw new ActionException("INVALID_PARAMS");
        }
        return com.mct.core.util.MctMaps.mapOf("slot", slot, "item", ClientDataHelper.itemToMap(player.getInventory().getItem(slot)));
    }

    private Map<String, Object> inventoryGet(Map<String, Object> params) {
        return waitForCondition(
            params,
            () -> com.mct.core.util.MctMaps.mapOf("slots", ClientDataHelper.slotsToList(requirePlayer().inventoryMenu.slots)),
            result -> slotsConditionMatches(params, result.get("slots"))
        );
    }

    private Map<String, Object> inventoryHeld(Map<String, Object> params) {
        return waitForCondition(
            params,
            () -> com.mct.core.util.MctMaps.mapOf("item", ClientDataHelper.itemToMap(requirePlayer().getMainHandItem())),
            result -> itemConditionMatches(params, result.get("item"))
        );
    }

    private Map<String, Object> setHotbar(Map<String, Object> params) {
        int slot = getInt(params, "slot");
        if (slot < 0 || slot > 8) {
            throw new ActionException("INVALID_PARAMS");
        }
        LocalPlayer player = requirePlayer();
        ClientVersionModulesHolder.get().compatibility().setSelectedSlot(player.getInventory(), slot);
        PacketSender.send(player.connection, new ServerboundSetCarriedItemPacket(slot));
        return com.mct.core.util.MctMaps.mapOf("selectedSlot", slot, "item", ClientDataHelper.itemToMap(player.getMainHandItem()));
    }

    private Map<String, Object> useHeldItem() {
        LocalPlayer player = requirePlayer();
        InteractionResult result = ClientVersionModulesHolder.get().interaction().interactItem(requireInteractionManager(), player, InteractionHand.MAIN_HAND);
        return com.mct.core.util.MctMaps.mapOf(
            "success", result.consumesAction(),
            "action", ClientVersionModulesHolder.get().actionResult().resultName(result),
            "item", ClientDataHelper.itemToMap(player.getMainHandItem())
        );
    }

    private boolean slotsConditionMatches(Map<String, Object> params, Object slots) {
        if (!hasItemCondition(params)) {
            return true;
        }
        if (!(slots instanceof Iterable<?> iterable)) {
            return false;
        }
        for (Object slot : iterable) {
            if (slot instanceof Map<?, ?> slotMap && itemConditionMatches(params, slotMap.get("item"))) {
                return true;
            }
        }
        return false;
    }

    private boolean itemConditionMatches(Map<String, Object> params, Object item) {
        if (!hasItemCondition(params)) {
            return true;
        }
        if (!(item instanceof Map<?, ?> itemMap)) {
            return false;
        }
        Object rawType = itemMap.get("type");
        String itemType = rawType == null ? "" : String.valueOf(rawType);
        String expectedType = getOptionalString(params, "type");
        if (expectedType != null && !expectedType.equals(itemType)) {
            return false;
        }
        String excludedType = getOptionalString(params, "notType");
        return excludedType == null || !excludedType.equals(itemType);
    }

    private boolean hasItemCondition(Map<String, Object> params) {
        return getOptionalString(params, "type") != null || getOptionalString(params, "notType") != null;
    }

    private Map<String, Object> swapHands() {
        ItemStack[] previous = runOnClientThread(() -> new ItemStack[] {
            requirePlayer().getMainHandItem().copy(),
            requirePlayer().getOffhandItem().copy()
        });

        runOnClientThread(() -> {
            LocalPlayer player = requirePlayer();
            PacketSender.send(
                player.connection,
                new ServerboundPlayerActionPacket(ServerboundPlayerActionPacket.Action.SWAP_ITEM_WITH_OFFHAND, BlockPos.ZERO, Direction.DOWN)
            );
            return true;
        });

        LinkedHashMap<String, Object> result = pollOnClientThread(
            2.0D,
            () -> {
                LocalPlayer player = requirePlayer();
                LinkedHashMap<String, Object> state = new LinkedHashMap<>();
                state.put("mainHand", ClientDataHelper.itemToMap(player.getMainHandItem()));
                state.put("offHand", ClientDataHelper.itemToMap(player.getOffhandItem()));
                state.put(
                    "swapped",
                    ItemStack.matches(player.getMainHandItem(), previous[1]) && ItemStack.matches(player.getOffhandItem(), previous[0])
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
        AbstractContainerScreen<?> screen = requireHandledScreen();
        LinkedHashMap<String, Object> result = new LinkedHashMap<>(ClientDataHelper.screenToMap(client));
        result.put("slots", ClientDataHelper.slotsToList(screen.getMenu().slots, screen));
        result.put("cursorItem", ClientDataHelper.itemToMap(screen.getMenu().getCarried()));
        return result;
    }

    private Map<String, Object> guiLayout() {
        AbstractContainerScreen<?> screen = requireHandledScreen();
        LinkedHashMap<String, Object> result = new LinkedHashMap<>(ClientDataHelper.screenToMap(client));
        result.put("slots", ClientDataHelper.slotsToList(screen.getMenu().slots, screen));
        result.put("scaledWidth", client.getWindow().getGuiScaledWidth());
        result.put("scaledHeight", client.getWindow().getGuiScaledHeight());
        result.put("framebufferWidth", client.getWindow().getWidth());
        result.put("framebufferHeight", client.getWindow().getHeight());
        result.put("scaleFactor", client.getWindow().getGuiScale());
        return result;
    }

    private Map<String, Object> guiSlot(Map<String, Object> params) {
        AbstractContainerScreen<?> screen = requireHandledScreen();
        int slot = getInt(params, "slot");
        AbstractContainerMenu handler = screen.getMenu();
        if (slot < 0 || slot >= handler.slots.size()) {
            throw new ActionException("INVALID_PARAMS");
        }
        return ClientDataHelper.slotToMap(handler.getSlot(slot), screen);
    }

    private Map<String, Object> guiClick(Map<String, Object> params) {
        LocalPlayer player = requirePlayer();
        AbstractContainerScreen<?> screen = requireHandledScreen();
        AbstractContainerMenu handler = screen.getMenu();
        int slot = getInt(params, "slot");
        String buttonName = getString(params, "button", "left");
        if (slot < -999 || slot >= handler.slots.size()) {
            throw new ActionException("INVALID_PARAMS");
        }

        ClickPlan plan = clickPlan(buttonName, getInt(params, "key", 0));
        requireInteractionManager().handleContainerInput(handler.containerId, slot, plan.button, plan.actionType, player);
        safeSleep(120L);
        return com.mct.core.util.MctMaps.mapOf(
            "success", true,
            "cursorItem", ClientDataHelper.itemToMap(handler.getCarried()),
            "slotItem", slot >= 0 ? ClientDataHelper.itemToMap(handler.getSlot(slot).getItem()) : ClientDataHelper.itemToMap(ItemStack.EMPTY)
        );
    }

    private Map<String, Object> guiDrag(Map<String, Object> params) {
        LocalPlayer player = requirePlayer();
        AbstractContainerScreen<?> screen = requireHandledScreen();
        AbstractContainerMenu handler = screen.getMenu();
        List<Object> slots = getList(params, "slots");
        int button = "right".equals(getString(params, "button")) ? 1 : 0;
        MultiPlayerGameMode interactionManager = requireInteractionManager();

        interactionManager.handleContainerInput(handler.containerId, -999, AbstractContainerMenu.getQuickcraftMask(0, button), ContainerInput.QUICK_CRAFT, player);
        for (Object value : slots) {
            int slot = asInt(value);
            interactionManager.handleContainerInput(handler.containerId, slot, AbstractContainerMenu.getQuickcraftMask(1, button), ContainerInput.QUICK_CRAFT, player);
        }
        interactionManager.handleContainerInput(handler.containerId, -999, AbstractContainerMenu.getQuickcraftMask(2, button), ContainerInput.QUICK_CRAFT, player);
        safeSleep(120L);
        return com.mct.core.util.MctMaps.mapOf("success", true, "cursorItem", ClientDataHelper.itemToMap(handler.getCarried()));
    }

    private Map<String, Object> closeGui() {
        Screen screen = currentScreen();
        if (screen != null) {
            screen.onClose();
            ClientVersionModulesHolder.get().compatibility().setScreen(client, null);
            client.mouseHandler.grabMouse();
        }
        return com.mct.core.util.MctMaps.mapOf("success", true);
    }

    private Map<String, Object> waitForGuiOpen(Map<String, Object> params) {
        double timeoutSeconds = getDouble(params, "timeout", DEFAULT_WAIT_TIMEOUT_SECONDS);
        Map<String, Object> result = pollOnClientThread(
            timeoutSeconds,
            () -> {
                if (currentScreen() == null) {
                    return com.mct.core.util.MctMaps.mapOf();
                }
                return ClientDataHelper.screenToMap(client);
            },
            map -> !map.isEmpty(),
            "TIMEOUT"
        );
        return com.mct.core.util.MctMaps.mapOf("opened", true, "screen", result);
    }

    private Map<String, Object> waitForGuiUpdate(Map<String, Object> params) {
        double timeoutSeconds = getDouble(params, "timeout", DEFAULT_WAIT_TIMEOUT_SECONDS);
        String initial = runOnClientThread(this::screenFingerprint);
        Map<String, Object> result = pollOnClientThread(
            timeoutSeconds,
            () -> {
                if (currentScreen() == null) {
                    return com.mct.core.util.MctMaps.mapOf();
                }
                String current = screenFingerprint();
                return !current.equals(initial) ? ClientDataHelper.screenToMap(client) : com.mct.core.util.MctMaps.mapOf();
            },
            map -> !map.isEmpty(),
            "TIMEOUT"
        );
        return com.mct.core.util.MctMaps.mapOf("updated", true, "screen", result);
    }

    private Map<String, Object> captureScreenshot(String output, @Nullable String region, boolean guiOnly) {
        try {
            Path outputPath = Path.of(output).toAbsolutePath();
            if (outputPath.getParent() != null) {
                Files.createDirectories(outputPath.getParent());
            }

            CompletableFuture<NativeImage> imageFuture = runOnClientThread(() -> ClientVersionModulesHolder.get().screenshot().capture(client));
            NativeImage image = imageFuture.get(SCREENSHOT_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            try {
                NativeImage toWrite = image;
                if (region != null && !region.trim().isEmpty()) {
                    toWrite = cropImage(image, region);
                }
                toWrite.writeToFile(outputPath);
                if (toWrite != image) {
                    toWrite.close();
                }
            } finally {
                image.close();
            }
            return com.mct.core.util.MctMaps.mapOf(
                "path", outputPath.toString(),
                "width", client.getWindow().getGuiScaledWidth(),
                "height", client.getWindow().getGuiScaledHeight(),
                "gui", guiOnly
            );
        } catch (TimeoutException exception) {
            throw new ActionException("TIMEOUT");
        } catch (IOException exception) {
            throw new ActionException("IO_ERROR");
        } catch (Exception exception) {
            throw new ActionException("INTERNAL_ERROR");
        }
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
        Screen screen = currentScreen();
        if (screen == null) {
            return "none";
        }
        if (screen instanceof AbstractContainerScreen<?> handledScreen) {
            StringBuilder builder = new StringBuilder();
            Component title = screen.getTitle();
            builder.append(screen.getClass().getName()).append('|').append(title != null ? title.getString() : "");
            for (int slot = 0; slot < handledScreen.getMenu().slots.size(); slot++) {
                ItemStack stack = handledScreen.getMenu().getSlot(slot).getItem();
                builder.append('|').append(slot).append(':').append(McRegistries.itemId(stack.getItem())).append('#').append(stack.getCount());
            }
            return builder.toString();
        }
        Component title = screen.getTitle();
        return screen.getClass().getName() + "|" + (title != null ? title.getString() : "");
    }

    private Screen currentScreen() {
        return ClientVersionModulesHolder.get().compatibility().getScreen(client);
    }

    private ClickPlan clickPlan(String buttonName, int key) {
        return switch (buttonName) {
            case "left" -> new ClickPlan(0, ContainerInput.PICKUP);
            case "right" -> new ClickPlan(1, ContainerInput.PICKUP);
            case "shift-left" -> new ClickPlan(0, ContainerInput.QUICK_MOVE);
            case "shift-right" -> new ClickPlan(1, ContainerInput.QUICK_MOVE);
            case "middle" -> new ClickPlan(2, ContainerInput.CLONE);
            case "double" -> new ClickPlan(0, ContainerInput.PICKUP_ALL);
            case "drop" -> new ClickPlan(0, ContainerInput.THROW);
            case "ctrl-drop" -> new ClickPlan(1, ContainerInput.THROW);
            default -> {
                if (buttonName.startsWith("number-")) {
                    int number = Integer.parseInt(buttonName.substring("number-".length()));
                    yield new ClickPlan(number - 1, ContainerInput.SWAP);
                }
                if (key >= 1 && key <= 9) {
                    yield new ClickPlan(key - 1, ContainerInput.SWAP);
                }
                throw new ActionException("INVALID_PARAMS");
            }
        };
    }

    private static final class ClickPlan {
        final int button;
        final ContainerInput actionType;

        ClickPlan(int button, ContainerInput actionType) {
            this.button = button;
            this.actionType = actionType;
        }
    }
}
