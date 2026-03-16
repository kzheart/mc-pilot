package com.mct.core.util;

import com.google.gson.internal.LinkedTreeMap;
import com.mct.mixin.AbstractSignEditScreenAccessor;
import com.mct.mixin.KeyboardInvoker;
import com.mct.mixin.KeyBindingAccessor;
import com.mct.mixin.MouseInvoker;
import com.mct.core.state.ClientStateTracker;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.SignBlockEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.gui.screen.ingame.AbstractSignEditScreen;
import net.minecraft.client.gui.screen.multiplayer.ConnectScreen;
import net.minecraft.client.gui.hud.BossBarHud;
import net.minecraft.client.gui.hud.ClientBossBar;
import net.minecraft.client.gui.hud.InGameHud;
import net.minecraft.client.gui.hud.PlayerListHud;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.gui.screen.ingame.HandledScreen;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ClientPlayerInteractionManager;
import net.minecraft.client.network.ClientPlayNetworkHandler;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.client.resource.server.ServerResourcePackLoader;
import net.minecraft.client.resource.server.ServerResourcePackManager;
import net.minecraft.client.texture.NativeImage;
import net.minecraft.client.util.InputUtil;
import net.minecraft.client.util.ScreenshotRecorder;
import net.minecraft.entity.Entity;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.network.packet.c2s.play.BookUpdateC2SPacket;
import net.minecraft.network.packet.c2s.play.PlayerActionC2SPacket;
import net.minecraft.network.packet.c2s.play.PlayerMoveC2SPacket;
import net.minecraft.network.packet.c2s.play.RenameItemC2SPacket;
import net.minecraft.network.packet.c2s.play.SelectMerchantTradeC2SPacket;
import net.minecraft.network.packet.c2s.play.UpdateSelectedSlotC2SPacket;
import net.minecraft.registry.Registries;
import net.minecraft.screen.AnvilScreenHandler;
import net.minecraft.screen.CraftingScreenHandler;
import net.minecraft.screen.EnchantmentScreenHandler;
import net.minecraft.screen.MerchantScreenHandler;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.ScreenHandlerType;
import net.minecraft.screen.slot.SlotActionType;
import net.minecraft.scoreboard.Scoreboard;
import net.minecraft.scoreboard.ScoreboardDisplaySlot;
import net.minecraft.scoreboard.ScoreboardEntry;
import net.minecraft.scoreboard.ScoreboardObjective;
import net.minecraft.scoreboard.Team;
import net.minecraft.text.Text;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.GameMode;
import org.jetbrains.annotations.Nullable;
import org.lwjgl.glfw.GLFW;

public final class ClientActionExecutor {

    private static final double DEFAULT_WAIT_TIMEOUT_SECONDS = 10.0D;
    private static final double MOVE_STEP_SECONDS = 0.12D;
    private static final double MOVE_TO_TIMEOUT_SECONDS = 30.0D;
    private static final long BOOK_UPDATE_COOLDOWN_MILLIS = 1500L;

    private final MinecraftClient client;
    private final ClientStateTracker stateTracker;
    private final Set<String> heldInputKeys = Collections.synchronizedSet(new LinkedHashSet<>());
    private volatile long lastBookUpdateAt;

    public ClientActionExecutor(MinecraftClient client) {
        this.client = client;
        this.stateTracker = ClientStateTracker.getInstance();
    }

    public Map<String, Object> execute(String action, Map<String, Object> params) {
        return switch (action) {
            case "chat.send" -> runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                player.networkHandler.sendChatMessage(getString(params, "message"));
                return Map.of("sent", true);
            });
            case "chat.command" -> runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                String command = stripLeadingSlash(getString(params, "command"));
                boolean sent = player.networkHandler.sendCommand(command);
                if (!sent) {
                    player.networkHandler.sendChatCommand(command);
                }
                return Map.of("sent", true, "unsigned", sent);
            });
            case "chat.history" -> runOnClientThread(() -> Map.of("messages", stateTracker.getChatHistory(getInt(params, "last", 10))));
            case "chat.last" -> runOnClientThread(() -> Map.of("message", stateTracker.getLastChatMessage()));
            case "chat.wait" -> waitForChat(params);
            case "position.get" -> runOnClientThread(() -> positionMap(requirePlayer()));
            case "rotation.get" -> runOnClientThread(() -> rotationMap(requirePlayer()));
            case "wait.perform" -> performWait(params);
            case "status.health" -> runOnClientThread(this::healthStatus);
            case "status.effects" -> runOnClientThread(this::effectsStatus);
            case "status.experience" -> runOnClientThread(this::experienceStatus);
            case "status.gamemode" -> runOnClientThread(this::gamemodeStatus);
            case "status.world" -> runOnClientThread(this::worldStatus);
            case "status.all" -> runOnClientThread(this::allStatus);
            case "screen.size" -> runOnClientThread(this::screenSize);
            case "input.click" -> inputClick(params);
            case "input.double-click" -> inputDoubleClick(params);
            case "input.mouse-move" -> inputMouseMove(params);
            case "input.drag" -> inputDrag(params);
            case "input.scroll" -> inputScroll(params);
            case "input.key-press" -> inputKeyPress(params);
            case "input.key-hold" -> inputKeyHold(params);
            case "input.key-down" -> inputKeyDown(params);
            case "input.key-up" -> inputKeyUp(params);
            case "input.key-combo" -> inputKeyCombo(params);
            case "input.type" -> inputType(params);
            case "input.mouse-pos" -> runOnClientThread(this::currentMousePosition);
            case "input.keys-down" -> inputKeysDown();
            case "look.set" -> runOnClientThread(() -> setRotation(requirePlayer(), (float) getDouble(params, "yaw"), (float) getDouble(params, "pitch")));
            case "look.at" -> runOnClientThread(() -> lookAt(requirePlayer(), getDouble(params, "x"), getDouble(params, "y"), getDouble(params, "z")));
            case "look.entity" -> runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                Entity entity = findEntity(requireFilter(params));
                Map<String, Object> rotated = lookAt(player, entity.getX(), entity.getEyeY(), entity.getZ());
                LinkedHashMap<String, Object> result = new LinkedHashMap<>(rotated);
                result.put("entityId", entity.getId());
                return result;
            });
            case "move.jump" -> runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                player.jump();
                return Map.of("success", true, "position", positionMap(player));
            });
            case "move.sneak" -> runOnClientThread(() -> {
                boolean enabled = getBoolean(params, "enabled", false);
                client.options.sneakKey.setPressed(enabled);
                return Map.of("sneaking", enabled);
            });
            case "move.sprint" -> runOnClientThread(() -> {
                boolean enabled = getBoolean(params, "enabled", false);
                client.options.sprintKey.setPressed(enabled);
                ClientPlayerEntity player = requirePlayer();
                player.setSprinting(enabled);
                return Map.of("sprinting", enabled);
            });
            case "move.direction" -> moveDirection(params);
            case "move.to" -> moveTo(params);
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
            case "hud.scoreboard" -> runOnClientThread(this::scoreboardStatus);
            case "hud.tab" -> runOnClientThread(this::tabStatus);
            case "hud.bossbar" -> runOnClientThread(this::bossBarStatus);
            case "hud.actionbar" -> runOnClientThread(this::actionBarStatus);
            case "hud.title" -> runOnClientThread(this::titleStatus);
            case "hud.nametag" -> runOnClientThread(() -> nameTagStatus(getString(params, "player")));
            case "capture.screenshot" -> captureScreenshot(getString(params, "output"), getOptionalString(params, "region"), getBoolean(params, "gui", false));
            case "client.reconnect" -> runOnClientThread(() -> reconnectClient(params));
            case "resourcepack.status" -> runOnClientThread(this::resourcePackStatus);
            case "resourcepack.accept" -> runOnClientThread(() -> {
                requireResourcePackLoader().acceptAll();
                return resourcePackStatus();
            });
            case "resourcepack.reject" -> runOnClientThread(() -> {
                requireResourcePackLoader().declineAll();
                return resourcePackStatus();
            });
            case "combat.kill" -> combatKill(params);
            case "combat.clear" -> combatClear(params);
            case "combat.engage" -> combatEngage(params);
            case "combat.chase" -> combatChase(params);
            case "combat.pickup" -> combatPickup(params);
            case "sign.read" -> runOnClientThread(() -> readSign(params));
            case "sign.edit" -> editSign(params);
            case "book.read" -> runOnClientThread(this::readBook);
            case "book.write" -> writeBook(params);
            case "book.sign" -> signBook(params);
            case "block.get" -> runOnClientThread(() -> getBlock(params));
            case "block.interact" -> runOnClientThread(() -> interactBlock(params));
            case "block.place" -> runOnClientThread(() -> placeBlock(params));
            case "block.break" -> breakBlock(params);
            case "entity.list" -> runOnClientThread(() -> listEntities(params));
            case "entity.info" -> runOnClientThread(() -> entityInfo(params));
            case "entity.attack" -> runOnClientThread(() -> attackEntity(params));
            case "entity.interact" -> runOnClientThread(() -> interactEntity(params));
            case "entity.mount" -> mountEntity(params);
            case "entity.dismount" -> dismountEntity();
            case "entity.steer" -> steerEntity(params);
            case "craft.enchant" -> runOnClientThread(() -> enchant(params));
            case "craft.trade" -> runOnClientThread(() -> trade(params));
            case "craft.anvil" -> anvil(params);
            case "craft.craft" -> craft(params);
            default -> throw new ActionException("INVALID_ACTION");
        };
    }

    private Map<String, Object> waitForChat(Map<String, Object> params) {
        Pattern pattern = compileFlexiblePattern(getString(params, "match"));
        long startedAt = System.currentTimeMillis();
        double timeoutSeconds = getDouble(params, "timeout", DEFAULT_WAIT_TIMEOUT_SECONDS);
        Map<String, Object> matched = pollOnClientThread(
            timeoutSeconds,
            () -> stateTracker.findLatestChatMessage(pattern, startedAt),
            result -> !result.isEmpty(),
            "TIMEOUT"
        );
        return Map.of("matched", true, "message", matched);
    }

    private Map<String, Object> performWait(Map<String, Object> params) {
        double seconds = getDouble(params, "seconds", 0.0D);
        int ticks = getInt(params, "ticks", 0);
        double timeoutSeconds = getDouble(params, "timeout", Math.max(DEFAULT_WAIT_TIMEOUT_SECONDS, seconds));

        long waitMillis = (long) Math.max(0, (seconds * 1000.0D) + (ticks * 50L));
        if (waitMillis > 0L) {
            safeSleep(waitMillis);
        }

        long startedAt = System.currentTimeMillis();
        if (getBoolean(params, "untilGuiOpen", false)) {
            pollOnClientThread(timeoutSeconds, () -> client.currentScreen != null, Boolean::booleanValue, "TIMEOUT");
        }
        if (params != null && params.get("untilHealthAbove") != null) {
            double threshold = getDouble(params, "untilHealthAbove");
            pollOnClientThread(
                timeoutSeconds,
                () -> requirePlayer().getHealth() > threshold,
                Boolean::booleanValue,
                "TIMEOUT"
            );
        }
        if (getBoolean(params, "untilOnGround", false)) {
            pollOnClientThread(timeoutSeconds, () -> requirePlayer().isOnGround(), Boolean::booleanValue, "TIMEOUT");
        }

        return Map.of(
            "waitedSeconds", Duration.ofMillis(System.currentTimeMillis() - startedAt + waitMillis).toMillis() / 1000.0D,
            "guiOpen", runOnClientThread(() -> client.currentScreen != null),
            "onGround", runOnClientThread(() -> requirePlayer().isOnGround())
        );
    }

    private Map<String, Object> healthStatus() {
        ClientPlayerEntity player = requirePlayer();
        return Map.of(
            "health", player.getHealth(),
            "maxHealth", player.getMaxHealth(),
            "food", player.getHungerManager().getFoodLevel(),
            "saturation", player.getHungerManager().getSaturationLevel(),
            "absorption", player.getAbsorptionAmount()
        );
    }

    private Map<String, Object> effectsStatus() {
        return Map.of("effects", ClientDataHelper.effectsToList(requirePlayer().getStatusEffects()));
    }

    private Map<String, Object> experienceStatus() {
        ClientPlayerEntity player = requirePlayer();
        return Map.of(
            "level", player.experienceLevel,
            "progress", player.experienceProgress,
            "total", player.totalExperience
        );
    }

    private Map<String, Object> gamemodeStatus() {
        ClientPlayerInteractionManager interactionManager = requireInteractionManager();
        GameMode gameMode = interactionManager.getCurrentGameMode();
        return Map.of("gameMode", gameMode != null ? gameMode.getName() : "unknown");
    }

    private Map<String, Object> worldStatus() {
        ClientPlayerEntity player = requirePlayer();
        return Map.of(
            "name", player.clientWorld.getRegistryKey().getValue().toString(),
            "dimension", player.clientWorld.getRegistryKey().getValue().toString(),
            "difficulty", player.clientWorld.getDifficulty().getName(),
            "time", player.clientWorld.getTime(),
            "weather", player.clientWorld.isThundering() ? "thunder" : player.clientWorld.isRaining() ? "rain" : "clear"
        );
    }

    private Map<String, Object> allStatus() {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("health", healthStatus());
        result.put("effects", effectsStatus());
        result.put("experience", experienceStatus());
        result.put("gamemode", gamemodeStatus());
        result.put("world", worldStatus());
        result.put("position", positionMap(requirePlayer()));
        return result;
    }

    private Map<String, Object> screenSize() {
        return Map.of(
            "width", client.getWindow().getScaledWidth(),
            "height", client.getWindow().getScaledHeight(),
            "scaleFactor", client.getWindow().getScaleFactor()
        );
    }

    private Map<String, Object> inputClick(Map<String, Object> params) {
        int x = getInt(params, "x");
        int y = getInt(params, "y");
        String button = normalizeMouseButton(getString(params, "button", "left"));
        List<String> modifiers = getStringList(params, "modifiers");
        return withTemporaryModifiers(modifiers, () -> {
            moveMouseTo(x, y);
            clickMouseButton(button);
            LinkedHashMap<String, Object> result = new LinkedHashMap<>();
            result.put("clicked", true);
            result.put("button", button);
            result.put("mouse", runOnClientThread(this::currentMousePosition));
            if (!modifiers.isEmpty()) {
                result.put("modifiers", modifiers);
            }
            return result;
        });
    }

    private Map<String, Object> inputDoubleClick(Map<String, Object> params) {
        int x = getInt(params, "x");
        int y = getInt(params, "y");
        String button = normalizeMouseButton(getString(params, "button", "left"));
        moveMouseTo(x, y);
        clickMouseButton(button);
        safeSleep(100L);
        clickMouseButton(button);
        return Map.of(
            "clicked", true,
            "button", button,
            "count", 2,
            "mouse", runOnClientThread(this::currentMousePosition)
        );
    }

    private Map<String, Object> inputMouseMove(Map<String, Object> params) {
        moveMouseTo(getInt(params, "x"), getInt(params, "y"));
        LinkedHashMap<String, Object> result = new LinkedHashMap<>(runOnClientThread(this::currentMousePosition));
        result.put("moved", true);
        return result;
    }

    private Map<String, Object> inputDrag(Map<String, Object> params) {
        int fromX = getInt(params, "fromX");
        int fromY = getInt(params, "fromY");
        int toX = getInt(params, "toX");
        int toY = getInt(params, "toY");
        String button = normalizeMouseButton(getString(params, "button", "left"));
        moveMouseTo(fromX, fromY);
        dispatchMouseButton(button, GLFW.GLFW_PRESS);
        safeSleep(50L);
        moveMouseTo(fromX, fromY);
        safeSleep(25L);
        int steps = Math.max(10, (int) Math.ceil(Math.hypot(toX - fromX, toY - fromY) / 8.0D));
        for (int step = 1; step <= steps; step++) {
            double progress = (double) step / (double) steps;
            int nextX = (int) Math.round(fromX + ((toX - fromX) * progress));
            int nextY = (int) Math.round(fromY + ((toY - fromY) * progress));
            moveMouseTo(nextX, nextY);
            safeSleep(25L);
        }
        dispatchMouseButton(button, GLFW.GLFW_RELEASE);
        return Map.of(
            "dragged", true,
            "button", button,
            "from", Map.of("x", fromX, "y", fromY),
            "to", Map.of("x", toX, "y", toY)
        );
    }

    private Map<String, Object> inputScroll(Map<String, Object> params) {
        int x = getInt(params, "x");
        int y = getInt(params, "y");
        int delta = getInt(params, "delta");
        moveMouseTo(x, y);
        runOnClientThread(() -> {
            ((MouseInvoker) client.mouse).mct$onMouseScroll(client.getWindow().getHandle(), 0.0D, delta);
            return true;
        });
        return Map.of(
            "scrolled", true,
            "delta", delta,
            "mouse", runOnClientThread(this::currentMousePosition)
        );
    }

    private Map<String, Object> inputKeyPress(Map<String, Object> params) {
        String keyName = getString(params, "key");
        pressInputBinding(resolveInputBinding(keyName), 100L);
        return Map.of("pressed", true, "key", normalizeInputName(keyName));
    }

    private Map<String, Object> inputKeyHold(Map<String, Object> params) {
        String keyName = getString(params, "key");
        long duration = Math.max(1L, getInt(params, "duration"));
        InputBinding binding = resolveInputBinding(keyName);
        Instant startedAt = Instant.now();
        dispatchInputBinding(binding, GLFW.GLFW_PRESS);
        safeSleep(duration);
        dispatchInputBinding(binding, GLFW.GLFW_RELEASE);
        return Map.of(
            "held", true,
            "key", binding.name(),
            "actualDuration", Duration.between(startedAt, Instant.now()).toMillis()
        );
    }

    private Map<String, Object> inputKeyDown(Map<String, Object> params) {
        InputBinding binding = resolveInputBinding(getString(params, "key"));
        dispatchInputBinding(binding, GLFW.GLFW_PRESS);
        return Map.of("down", true, "key", binding.name(), "keys", snapshotHeldInputKeys());
    }

    private Map<String, Object> inputKeyUp(Map<String, Object> params) {
        InputBinding binding = resolveInputBinding(getString(params, "key"));
        dispatchInputBinding(binding, GLFW.GLFW_RELEASE);
        return Map.of("up", true, "key", binding.name(), "keys", snapshotHeldInputKeys());
    }

    private Map<String, Object> inputKeyCombo(Map<String, Object> params) {
        List<InputBinding> keys = getList(params, "keys").stream()
            .map(String::valueOf)
            .map(this::resolveInputBinding)
            .toList();
        for (InputBinding binding : keys) {
            dispatchInputBinding(binding, GLFW.GLFW_PRESS);
            safeSleep(35L);
        }
        safeSleep(75L);
        for (int index = keys.size() - 1; index >= 0; index--) {
            dispatchInputBinding(keys.get(index), GLFW.GLFW_RELEASE);
            safeSleep(20L);
        }
        return Map.of(
            "pressed", true,
            "keys", keys.stream().map(InputBinding::name).toList()
        );
    }

    private Map<String, Object> inputType(Map<String, Object> params) {
        String text = getString(params, "text");
        runOnClientThread(() -> {
            if (client.currentScreen == null || client.getOverlay() != null) {
                throw new ActionException("INVALID_STATE");
            }
            long window = client.getWindow().getHandle();
            KeyboardInvoker keyboard = (KeyboardInvoker) client.keyboard;
            text.codePoints().forEach(codePoint -> keyboard.mct$onChar(window, codePoint, 0));
            return true;
        });
        return Map.of("typed", true, "text", text);
    }

    private Map<String, Object> inputKeysDown() {
        return Map.of("keys", snapshotHeldInputKeys());
    }

    private Map<String, Object> moveDirection(Map<String, Object> params) {
        String direction = getString(params, "direction");
        double blocks = getDouble(params, "blocks");
        ClientPlayerEntity player = requirePlayer();
        Vec3d start = player.getPos();
        long deadline = System.currentTimeMillis() + (long) (Math.max(1.5D, Math.abs(blocks) * 2.0D) * 1000.0D);
        while (System.currentTimeMillis() < deadline) {
            double moved = runOnClientThread(() -> requirePlayer().getPos().distanceTo(start));
            if (moved >= Math.abs(blocks) - 0.15D) {
                break;
            }
            pressMovementKey(directionKey(direction), (long) (MOVE_STEP_SECONDS * 1000.0D));
        }
        return runOnClientThread(() -> Map.of("newPos", positionMap(requirePlayer())));
    }

    private Map<String, Object> moveTo(Map<String, Object> params) {
        double x = getDouble(params, "x");
        double y = getDouble(params, "y");
        double z = getDouble(params, "z");
        double timeoutSeconds = getDouble(params, "timeout", MOVE_TO_TIMEOUT_SECONDS);
        Instant startedAt = Instant.now();
        Vec3d target = new Vec3d(x, y, z);
        double bestDistance = Double.MAX_VALUE;
        int stalledSteps = 0;
        boolean strafeLeft = true;

        while (Duration.between(startedAt, Instant.now()).toMillis() < (long) (timeoutSeconds * 1000.0D)) {
            Map<String, Object> status = runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                Vec3d position = player.getPos();
                Vec3d delta = target.subtract(position);
                double horizontal = Math.sqrt(delta.x * delta.x + delta.z * delta.z);
                if (horizontal < 0.75D && Math.abs(delta.y) < 1.25D) {
                    LinkedHashMap<String, Object> result = new LinkedHashMap<>();
                    result.put("arrived", true);
                    result.put("finalPos", positionMap(player));
                    result.put("distance", position.distanceTo(target));
                    return result;
                }
                lookAt(player, target.x, target.y, target.z);
                if (delta.y > 0.6D && player.isOnGround()) {
                    player.jump();
                }
                return Map.of(
                    "arrived", false,
                    "distance", position.distanceTo(target),
                    "horizontal", horizontal,
                    "vertical", Math.abs(delta.y)
                );
            });
            if (Boolean.TRUE.equals(status.get("arrived"))) {
                return status;
            }
            double currentDistance = asDouble(status.get("distance"));
            double currentHorizontal = asDouble(status.get("horizontal"));
            double currentVertical = asDouble(status.get("vertical"));
            if (currentDistance + 0.05D < bestDistance) {
                bestDistance = currentDistance;
                stalledSteps = 0;
            } else {
                stalledSteps++;
            }
            if (stalledSteps >= 4 && currentHorizontal < 2.75D && currentVertical < 1.5D) {
                return Map.of(
                    "arrived", true,
                    "finalPos", runOnClientThread(() -> positionMap(requirePlayer())),
                    "distance", currentDistance
                );
            }
            if (stalledSteps >= 4) {
                pressMovementKeys(true, false, strafeLeft, !strafeLeft, true, false, 250L);
                strafeLeft = !strafeLeft;
                stalledSteps = 0;
                continue;
            }
            pressMovementKey(client.options.forwardKey, (long) (MOVE_STEP_SECONDS * 1000.0D));
        }

        ClientPlayerEntity player = runOnClientThread(this::requirePlayer);
        return Map.of(
            "arrived", false,
            "finalPos", runOnClientThread(() -> positionMap(requirePlayer())),
            "distance", player.getPos().distanceTo(target)
        );
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
        ActionResult result = requireInteractionManager().interactItem(player, Hand.MAIN_HAND);
        return Map.of(
            "success", result.isAccepted(),
            "action", result.name(),
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
        requireInteractionManager().clickSlot(handler.syncId, slot, plan.button(), plan.actionType(), player);
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

    private Map<String, Object> scoreboardStatus() {
        Scoreboard scoreboard = requirePlayer().clientWorld.getScoreboard();
        ScoreboardObjective objective = scoreboard.getObjectiveForSlot(ScoreboardDisplaySlot.SIDEBAR);
        if (objective == null) {
            return Map.of("title", "", "entries", List.of());
        }
        ArrayList<Map<String, Object>> entries = new ArrayList<>();
        scoreboard.getScoreboardEntries(objective).stream()
            .filter(entry -> !entry.hidden())
            .sorted(Comparator.comparingInt(ScoreboardEntry::value).reversed())
            .forEach(entry -> entries.add(Map.of("name", entry.name().getString(), "score", entry.value())));
        return Map.of("title", objective.getDisplayName().getString(), "entries", entries);
    }

    private Map<String, Object> tabStatus() {
        ClientPlayNetworkHandler networkHandler = requirePlayer().networkHandler;
        PlayerListHud playerListHud = client.inGameHud.getPlayerListHud();
        ArrayList<Map<String, Object>> players = new ArrayList<>();
        for (PlayerListEntry entry : networkHandler.getPlayerList()) {
            players.add(
                ClientDataHelper.playerListEntryToMap(
                    entry,
                    playerListHud.getPlayerName(entry),
                    entry.getScoreboardTeam()
                )
            );
        }
        LinkedHashMap<String, Object> result = new LinkedHashMap<>(stateTracker.getTabListState());
        result.put("players", players);
        return result;
    }

    private Map<String, Object> bossBarStatus() {
        return Map.of("bossBars", stateTracker.getBossBars());
    }

    private Map<String, Object> actionBarStatus() {
        return stateTracker.getActionBarState();
    }

    private Map<String, Object> titleStatus() {
        return stateTracker.getTitleState();
    }

    private Map<String, Object> nameTagStatus(String playerName) {
        ClientPlayNetworkHandler networkHandler = requirePlayer().networkHandler;
        Optional<PlayerListEntry> entry = networkHandler.getPlayerList().stream()
            .filter(candidate -> candidate.getProfile().getName().equalsIgnoreCase(playerName))
            .findFirst();
        if (entry.isEmpty()) {
            throw new ActionException("ENTITY_NOT_FOUND");
        }
        Team team = entry.get().getScoreboardTeam();
        return Map.of(
            "displayName", client.inGameHud.getPlayerListHud().getPlayerName(entry.get()).getString(),
            "prefix", team != null ? team.getPrefix().getString() : "",
            "suffix", team != null ? team.getSuffix().getString() : ""
        );
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

    private Map<String, Object> resourcePackStatus() {
        requireResourcePackLoader();
        return stateTracker.getResourcePackState();
    }

    private Map<String, Object> reconnectClient(Map<String, Object> params) {
        String address = getOptionalString(params, "address");
        if (address == null || address.isBlank()) {
            address = System.getenv("MCT_CLIENT_SERVER");
        }
        if (address == null || address.isBlank() || !ServerAddress.isValid(address)) {
            throw new ActionException("INVALID_PARAMS");
        }

        Screen parent = client.currentScreen != null ? client.currentScreen : new TitleScreen();
        ServerAddress serverAddress = ServerAddress.parse(address);
        ServerInfo serverInfo = new ServerInfo("MCT Auto Test", address, ServerInfo.ServerType.OTHER);
        ConnectScreen.connect(parent, client, serverAddress, serverInfo, false);
        return Map.of("connecting", true, "address", address);
    }

    private Map<String, Object> readSign(Map<String, Object> params) {
        SignBlockEntity sign = requireSign(params);
        return Map.of(
            "front", ClientDataHelper.signText(sign, true, false),
            "back", ClientDataHelper.signText(sign, false, false),
            "waxed", sign.isWaxed()
        );
    }

    private Map<String, Object> editSign(Map<String, Object> params) {
        List<Object> lines = getList(params, "lines");
        if (lines.size() != 4) {
            throw new ActionException("INVALID_PARAMS");
        }
        String[] values = new String[4];
        for (int index = 0; index < 4; index++) {
            values[index] = String.valueOf(lines.get(index));
        }

        BlockPos pos = runOnClientThread(() -> {
            SignBlockEntity sign = requireSign(params);
            BlockPos target = sign.getPos();
            if (!(client.currentScreen instanceof AbstractSignEditScreen)) {
                ClientPlayerEntity player = requirePlayer();
                requireInteractionManager().interactBlock(
                    player,
                    Hand.MAIN_HAND,
                    new BlockHitResult(Vec3d.ofCenter(target), inferHitSide(target), target, false)
                );
            }
            return target;
        });

        pollOnClientThread(3.0D, () -> client.currentScreen instanceof AbstractSignEditScreen, Boolean::booleanValue, "TIMEOUT");

        runOnClientThread(() -> {
            if (!(client.currentScreen instanceof AbstractSignEditScreen screen)) {
                throw new ActionException("INVALID_STATE");
            }
            AbstractSignEditScreenAccessor accessor = (AbstractSignEditScreenAccessor) screen;
            for (int index = 0; index < values.length; index++) {
                accessor.mct$setCurrentRow(index);
                accessor.mct$setCurrentRowMessage(values[index]);
            }
            client.setScreen(null);
            return true;
        });

        return pollOnClientThread(
            3.0D,
            () -> {
                SignBlockEntity sign = requireSign(Map.of("x", pos.getX(), "y", pos.getY(), "z", pos.getZ()));
                return Map.of(
                    "front", ClientDataHelper.signText(sign, true, false),
                    "back", ClientDataHelper.signText(sign, false, false),
                    "waxed", sign.isWaxed()
                );
            },
            data -> {
                Object front = data.get("front");
                if (!(front instanceof List<?> text) || text.size() < 4) {
                    return false;
                }
                return values[0].equals(String.valueOf(text.get(0)))
                    && values[1].equals(String.valueOf(text.get(1)))
                    && values[2].equals(String.valueOf(text.get(2)))
                    && values[3].equals(String.valueOf(text.get(3)));
            },
            "TIMEOUT"
        );
    }

    private Map<String, Object> readBook() {
        ItemStack stack = requireBookStack();
        List<String> pages = new ArrayList<>();
        if (stack.hasNbt() && stack.getNbt() != null) {
            net.minecraft.client.gui.screen.ingame.BookScreen.filterPages(stack.getNbt(), pages::add);
        }
        return Map.of("pages", pages, "item", ClientDataHelper.itemToMap(stack));
    }

    private Map<String, Object> writeBook(Map<String, Object> params) {
        List<String> pages = getList(params, "pages").stream().map(String::valueOf).toList();
        waitForBookUpdateCooldown();
        Map<String, Object> result = runOnClientThread(() -> {
            ClientPlayerEntity player = requirePlayer();
            ItemStack stack = requireWritableBook(player.getMainHandStack());
            player.networkHandler.sendPacket(new BookUpdateC2SPacket(player.getInventory().selectedSlot, pages, Optional.empty()));
            lastBookUpdateAt = System.currentTimeMillis();
            return Map.of("written", true, "pages", pages, "item", ClientDataHelper.itemToMap(stack));
        });
        safeSleep(BOOK_UPDATE_COOLDOWN_MILLIS);
        return result;
    }

    private Map<String, Object> signBook(Map<String, Object> params) {
        String title = getString(params, "title");
        waitForBookUpdateCooldown();
        Map<String, Object> result = runOnClientThread(() -> {
            ClientPlayerEntity player = requirePlayer();
            ItemStack stack = requireWritableBook(player.getMainHandStack());
            List<String> pages = new ArrayList<>();
            if (stack.hasNbt() && stack.getNbt() != null) {
                net.minecraft.client.gui.screen.ingame.BookScreen.filterPages(stack.getNbt(), pages::add);
            }
            player.networkHandler.sendPacket(new BookUpdateC2SPacket(player.getInventory().selectedSlot, pages, Optional.of(title)));
            lastBookUpdateAt = System.currentTimeMillis();
            return Map.of("signed", true, "title", title, "author", getString(params, "author", player.getName().getString()));
        });
        safeSleep(BOOK_UPDATE_COOLDOWN_MILLIS);
        return result;
    }

    private Map<String, Object> getBlock(Map<String, Object> params) {
        BlockPos pos = blockPos(params);
        var world = requirePlayer().clientWorld;
        var state = world.getBlockState(pos);
        LinkedHashMap<String, Object> properties = new LinkedHashMap<>();
        state.getEntries().forEach((property, value) -> properties.put(property.getName(), String.valueOf(value)));
        return Map.of(
            "type", String.valueOf(Registries.BLOCK.getId(state.getBlock())),
            "properties", properties,
            "lightLevel", world.getLightLevel(pos)
        );
    }

    private void waitForBookUpdateCooldown() {
        long remaining = BOOK_UPDATE_COOLDOWN_MILLIS - (System.currentTimeMillis() - lastBookUpdateAt);
        if (remaining > 0L) {
            safeSleep(remaining);
        }
    }

    private Map<String, Object> interactBlock(Map<String, Object> params) {
        ClientPlayerEntity player = requirePlayer();
        BlockPos pos = blockPos(params);
        Direction face = inferHitSide(pos);
        ActionResult result = requireInteractionManager().interactBlock(
            player,
            Hand.MAIN_HAND,
            new BlockHitResult(Vec3d.ofCenter(pos), face, pos, false)
        );
        return Map.of("success", result.isAccepted(), "resultAction", result.name());
    }

    private Map<String, Object> placeBlock(Map<String, Object> params) {
        ClientPlayerEntity player = requirePlayer();
        BlockPos target = blockPos(params);
        Direction face = Direction.byName(getString(params, "face"));
        if (face == null) {
            throw new ActionException("INVALID_PARAMS");
        }
        BlockPos support = target.offset(face.getOpposite());
        BlockHitResult hit = new BlockHitResult(Vec3d.ofCenter(support), face, support, false);
        ActionResult result = requireInteractionManager().interactBlock(player, Hand.MAIN_HAND, hit);
        Instant startedAt = Instant.now();
        while (Duration.between(startedAt, Instant.now()).toMillis() < 2_000L) {
            String placedType = String.valueOf(Registries.BLOCK.getId(requirePlayer().clientWorld.getBlockState(target).getBlock()));
            if (!"minecraft:air".equals(placedType)) {
                return Map.of(
                    "success", result.isAccepted(),
                    "placedType", placedType
                );
            }
            safeSleep(50L);
        }
        return Map.of(
            "success", false,
            "placedType", String.valueOf(Registries.BLOCK.getId(requirePlayer().clientWorld.getBlockState(target).getBlock()))
        );
    }

    private Map<String, Object> breakBlock(Map<String, Object> params) {
        BlockPos pos = runOnClientThread(() -> blockPos(params));
        Direction side = runOnClientThread(() -> inferHitSide(pos));
        Instant startedAt = Instant.now();
        runOnClientThread(() -> requireInteractionManager().attackBlock(pos, side));
        while (Duration.between(startedAt, Instant.now()).toMillis() < 15_000L) {
            boolean done = runOnClientThread(() -> requirePlayer().clientWorld.getBlockState(pos).isAir());
            if (done) {
                return runOnClientThread(() -> Map.of(
                    "success", true,
                    "blockType", "minecraft:air",
                    "duration", Duration.between(startedAt, Instant.now()).toMillis()
                ));
            }
            runOnClientThread(() -> {
                requireInteractionManager().updateBlockBreakingProgress(pos, side);
                return true;
            });
            safeSleep(100L);
        }
        runOnClientThread(() -> {
            requireInteractionManager().cancelBlockBreaking();
            return true;
        });
        return Map.of(
            "success", false,
            "blockType", runOnClientThread(() -> String.valueOf(Registries.BLOCK.getId(requirePlayer().clientWorld.getBlockState(pos).getBlock()))),
            "duration", Duration.between(startedAt, Instant.now()).toMillis()
        );
    }

    private Map<String, Object> listEntities(Map<String, Object> params) {
        ClientPlayerEntity player = requirePlayer();
        double radius = getDouble(params, "radius", 10.0D);
        ArrayList<Map<String, Object>> entities = new ArrayList<>();
        for (Entity entity : player.clientWorld.getEntities()) {
            if (entity == player || player.distanceTo(entity) > radius) {
                continue;
            }
            entities.add(ClientDataHelper.entityToMap(entity, player));
        }
        return Map.of("entities", entities);
    }

    private Map<String, Object> entityInfo(Map<String, Object> params) {
        int id = getInt(params, "id");
        Entity entity = requirePlayer().clientWorld.getEntityById(id);
        if (entity == null) {
            throw new ActionException("ENTITY_NOT_FOUND");
        }
        return ClientDataHelper.entityToMap(entity, requirePlayer());
    }

    private Map<String, Object> attackEntity(Map<String, Object> params) {
        ClientPlayerEntity player = requirePlayer();
        Entity entity = findEntity(requireFilter(params));
        requireInteractionManager().attackEntity(player, entity);
        player.swingHand(Hand.MAIN_HAND);
        return Map.of("success", true, "entityId", entity.getId(), "entityType", String.valueOf(Registries.ENTITY_TYPE.getId(entity.getType())));
    }

    private Map<String, Object> combatKill(Map<String, Object> params) {
        return combatAttackLoop(requireFilter(params), getDouble(params, "timeout", 30.0D), true);
    }

    private Map<String, Object> combatEngage(Map<String, Object> params) {
        return combatAttackLoop(requireFilter(params), getDouble(params, "timeout", 180.0D), true);
    }

    private Map<String, Object> combatChase(Map<String, Object> params) {
        return combatAttackLoop(requireFilter(params), getDouble(params, "timeout", 120.0D), true);
    }

    private Map<String, Object> combatClear(Map<String, Object> params) {
        String type = normalizeEntityType(getString(params, "type"));
        double radius = getDouble(params, "radius", 16.0D);
        double timeoutSeconds = getDouble(params, "timeout", 60.0D);
        Instant startedAt = Instant.now();
        int killed = 0;

        while (Duration.between(startedAt, Instant.now()).toMillis() < (long) (timeoutSeconds * 1000.0D)) {
            Map<String, Object> filter = Map.of("type", type, "nearest", true, "maxDistance", radius);
            try {
                Map<String, Object> result = combatAttackLoop(filter, Math.max(2.0D, timeoutSeconds - elapsedSeconds(startedAt)), true);
                if (Boolean.TRUE.equals(result.get("killed"))) {
                    killed += asInt(result.get("killedCount"));
                    continue;
                }
            } catch (ActionException exception) {
                if (!"ENTITY_NOT_FOUND".equals(exception.getCode())) {
                    throw exception;
                }
            }
            break;
        }

        int remaining = runOnClientThread(() -> countEntities(Map.of("type", type, "maxDistance", radius)));
        return Map.of(
            "killed", killed,
            "duration", elapsedSeconds(startedAt),
            "remaining", remaining
        );
    }

    private Map<String, Object> combatPickup(Map<String, Object> params) {
        double radius = getDouble(params, "radius", 5.0D);
        double timeoutSeconds = getDouble(params, "timeout", 10.0D);
        Instant startedAt = Instant.now();
        ArrayList<Map<String, Object>> picked = new ArrayList<>();

        while (Duration.between(startedAt, Instant.now()).toMillis() < (long) (timeoutSeconds * 1000.0D)) {
            Map<String, Object> next = runOnClientThread(() -> nearestItemEntity(radius));
            if (next.isEmpty()) {
                break;
            }
            picked.add((Map<String, Object>) next.get("item"));
            double remainingTimeout = Math.max(0.5D, timeoutSeconds - elapsedSeconds(startedAt));
            moveTo(Map.of("x", next.get("x"), "y", next.get("y"), "z", next.get("z"), "timeout", remainingTimeout));
            int entityId = asInt(next.get("entityId"));
            double pickupWaitTimeout = Math.min(2.0D, Math.max(0.2D, timeoutSeconds - elapsedSeconds(startedAt)));
            pollUntil(
                pickupWaitTimeout,
                () -> requirePlayer().clientWorld.getEntityById(entityId) == null,
                Boolean::booleanValue
            );
        }

        return Map.of("picked", picked);
    }

    private Map<String, Object> combatAttackLoop(Map<String, Object> filter, double timeoutSeconds, boolean approachTarget) {
        Instant startedAt = Instant.now();
        int hits = 0;
        Integer lastTargetId = null;

        while (Duration.between(startedAt, Instant.now()).toMillis() < (long) (timeoutSeconds * 1000.0D)) {
            Map<String, Object> target = currentTargetState(filter);
            if (target.isEmpty()) {
                return Map.of(
                    "killed", lastTargetId != null,
                    "hits", hits,
                    "duration", elapsedSeconds(startedAt),
                    "killedCount", lastTargetId != null ? 1 : 0
                );
            }

            lastTargetId = asInt(target.get("entityId"));
            double distance = asDouble(target.get("distance"));
            if (approachTarget && distance > 2.9D) {
                approachCombatTargetStep(target, timeoutSeconds - elapsedSeconds(startedAt));
                safeSleep(100L);
                continue;
            }

            if (distance > 4.5D) {
                safeSleep(100L);
                continue;
            }

            Boolean attacked = runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                Entity entity = player.clientWorld.getEntityById(asInt(target.get("entityId")));
                if (entity == null || !entity.isAlive()) {
                    return false;
                }
                lookAt(player, entity.getX(), entity.getEyeY(), entity.getZ());
                if (player.getAttackCooldownProgress(0.0F) < 0.9F) {
                    return false;
                }
                requireInteractionManager().attackEntity(player, entity);
                player.swingHand(Hand.MAIN_HAND);
                return true;
            });
            if (Boolean.TRUE.equals(attacked)) {
                hits++;
                double confirmTimeout = Math.min(1.5D, Math.max(0.4D, timeoutSeconds - elapsedSeconds(startedAt) + 0.5D));
                if (waitForCombatTargetDefeat(lastTargetId, filter, confirmTimeout)) {
                    return Map.of(
                        "killed", true,
                        "hits", hits,
                        "duration", elapsedSeconds(startedAt),
                        "killedCount", 1
                    );
                }
            }
            safeSleep(150L);
        }

        boolean defeated = hits > 0 && waitForCombatTargetDefeat(lastTargetId, filter, 2.5D);
        return Map.of(
            "killed", defeated,
            "hits", hits,
            "duration", elapsedSeconds(startedAt),
            "killedCount", defeated ? 1 : 0
        );
    }

    private void approachCombatTargetStep(Map<String, Object> target, double remainingTimeoutSeconds) {
        if (remainingTimeoutSeconds <= 0.2D) {
            return;
        }

        Map<String, Object> nextStep = runOnClientThread(() -> {
            ClientPlayerEntity player = requirePlayer();
            double targetX = asDouble(target.get("x"));
            double targetY = asDouble(target.get("y"));
            double targetZ = asDouble(target.get("z"));
            double dx = targetX - player.getX();
            double dz = targetZ - player.getZ();
            double horizontal = Math.sqrt(dx * dx + dz * dz);
            double travel = horizontal < 0.001D ? 0.0D : Math.min(1.6D, Math.max(0.45D, horizontal - 2.2D));
            double scale = horizontal < 0.001D ? 0.0D : travel / horizontal;

            LinkedHashMap<String, Object> result = new LinkedHashMap<>();
            result.put("x", player.getX() + (dx * scale));
            result.put("y", Math.abs(targetY - player.getY()) > 0.9D ? targetY : player.getY());
            result.put("z", player.getZ() + (dz * scale));
            result.put("timeout", Math.max(0.5D, Math.min(1.5D, remainingTimeoutSeconds)));
            return result;
        });

        moveTo(nextStep);
    }

    private Map<String, Object> interactEntity(Map<String, Object> params) {
        ClientPlayerEntity player = requirePlayer();
        Entity entity = findEntity(requireFilter(params));
        ActionResult result = requireInteractionManager().interactEntity(player, entity, Hand.MAIN_HAND);
        return Map.of("success", result.isAccepted(), "entityId", entity.getId(), "entityType", String.valueOf(Registries.ENTITY_TYPE.getId(entity.getType())));
    }

    private Map<String, Object> mountEntity(Map<String, Object> params) {
        Map<String, Object> interaction = runOnClientThread(() -> {
            ClientPlayerEntity player = requirePlayer();
            Entity entity = findEntity(requireFilter(params));
            ActionResult result = requireInteractionManager().interactEntity(player, entity, Hand.MAIN_HAND);
            return Map.of(
                "accepted", result.isAccepted(),
                "vehicleId", entity.getId()
            );
        });
        boolean accepted = Boolean.TRUE.equals(interaction.get("accepted"));
        if (!accepted) {
            return Map.of("success", false, "vehicleId", -1);
        }
        Map<String, Object> mounted = pollUntil(
            2.0D,
            () -> {
                ClientPlayerEntity player = requirePlayer();
                Entity vehicle = player.getVehicle();
                if (vehicle == null) {
                    return Map.of();
                }
                return Map.of("success", true, "vehicleId", vehicle.getId());
            },
            result -> !result.isEmpty()
        );
        if (mounted.isEmpty()) {
            return Map.of("success", false, "vehicleId", -1);
        }
        return mounted;
    }

    private Map<String, Object> dismountEntity() {
        boolean hadVehicle = runOnClientThread(() -> {
            ClientPlayerEntity player = requirePlayer();
            boolean mounted = player.hasVehicle();
            if (mounted) {
                player.dismountVehicle();
            }
            return mounted;
        });
        if (!hadVehicle) {
            return Map.of("success", false);
        }
        Boolean dismounted = pollUntil(2.0D, () -> !requirePlayer().hasVehicle(), Boolean::booleanValue);
        return Map.of("success", Boolean.TRUE.equals(dismounted));
    }

    private Map<String, Object> steerEntity(Map<String, Object> params) {
        if (!requirePlayer().hasVehicle()) {
            throw new ActionException("INVALID_STATE");
        }
        boolean forward = getDouble(params, "forward", 0.0D) > 0.0D;
        boolean back = getDouble(params, "forward", 0.0D) < 0.0D;
        boolean left = getDouble(params, "sideways", 0.0D) > 0.0D;
        boolean right = getDouble(params, "sideways", 0.0D) < 0.0D;
        boolean jump = getBoolean(params, "jump", false);
        boolean sneak = getBoolean(params, "sneak", false);
        pressMovementKeys(forward, back, left, right, jump, sneak, 300L);
        return runOnClientThread(() -> Map.of("newPos", positionMap(requirePlayer())));
    }

    private Map<String, Object> enchant(Map<String, Object> params) {
        EnchantmentScreenHandler handler = requireScreenHandler(EnchantmentScreenHandler.class);
        int option = getInt(params, "option");
        if (option < 0 || option > 2) {
            throw new ActionException("INVALID_PARAMS");
        }
        requireInteractionManager().clickButton(handler.syncId, option);
        return Map.of("selectedOption", option, "success", true);
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
            return Map.of("success", false, "index", index, "result", ClientDataHelper.itemToMap(ItemStack.EMPTY));
        }
        requireInteractionManager().clickSlot(handler.syncId, 2, 0, SlotActionType.QUICK_MOVE, requirePlayer());
        safeSleep(120L);
        return Map.of("success", true, "index", index, "result", ClientDataHelper.itemToMap(preview));
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
        return Map.of("success", true, "rename", rename, "result", ClientDataHelper.itemToMap(preview));
    }

    private Map<String, Object> craft(Map<String, Object> params) {
        Object recipeValue = getRequired(params, "recipe");
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
        return Map.of("crafted", true, "result", ClientDataHelper.itemToMap(preview));
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
            if (!stack.isEmpty() && normalizeItemId(String.valueOf(Registries.ITEM.getId(stack.getItem()))).equals(itemId)) {
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
                builder.append('|').append(slot).append(':').append(Registries.ITEM.getId(stack.getItem())).append('#').append(stack.getCount());
            }
            return builder.toString();
        }
        Text title = client.currentScreen.getTitle();
        return client.currentScreen.getClass().getName() + "|" + (title != null ? title.getString() : "");
    }

    private KeyBinding directionKey(String direction) {
        return switch (direction) {
            case "forward" -> client.options.forwardKey;
            case "back" -> client.options.backKey;
            case "left" -> client.options.leftKey;
            case "right" -> client.options.rightKey;
            default -> throw new ActionException("INVALID_PARAMS");
        };
    }

    private void pressMovementKey(KeyBinding key, long milliseconds) {
        runOnClientThread(() -> {
            key.setPressed(true);
            return true;
        });
        safeSleep(milliseconds);
        runOnClientThread(() -> {
            key.setPressed(false);
            return true;
        });
        safeSleep(40L);
    }

    private void pressMovementKeys(boolean forward, boolean back, boolean left, boolean right, boolean jump, boolean sneak, long milliseconds) {
        runOnClientThread(() -> {
            client.options.forwardKey.setPressed(forward);
            client.options.backKey.setPressed(back);
            client.options.leftKey.setPressed(left);
            client.options.rightKey.setPressed(right);
            client.options.jumpKey.setPressed(jump);
            client.options.sneakKey.setPressed(sneak);
            return true;
        });
        safeSleep(milliseconds);
        runOnClientThread(() -> {
            client.options.forwardKey.setPressed(false);
            client.options.backKey.setPressed(false);
            client.options.leftKey.setPressed(false);
            client.options.rightKey.setPressed(false);
            client.options.jumpKey.setPressed(false);
            client.options.sneakKey.setPressed(false);
            return true;
        });
    }

    private Map<String, Object> lookAt(ClientPlayerEntity player, double x, double y, double z) {
        Vec3d eye = player.getEyePos();
        double dx = x - eye.x;
        double dy = y - eye.y;
        double dz = z - eye.z;
        double horizontal = Math.sqrt(dx * dx + dz * dz);
        float yaw = MathHelper.wrapDegrees((float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0D));
        float pitch = MathHelper.wrapDegrees((float) (-Math.toDegrees(Math.atan2(dy, horizontal))));
        return setRotation(player, yaw, pitch);
    }

    private Map<String, Object> setRotation(ClientPlayerEntity player, float yaw, float pitch) {
        player.setYaw(yaw);
        player.setPitch(pitch);
        player.setHeadYaw(yaw);
        player.setBodyYaw(yaw);
        player.networkHandler.sendPacket(new PlayerMoveC2SPacket.LookAndOnGround(yaw, pitch, player.isOnGround()));
        return Map.of("yaw", yaw, "pitch", pitch);
    }

    private Map<String, Object> positionMap(ClientPlayerEntity player) {
        return Map.of(
            "x", player.getX(),
            "y", player.getY(),
            "z", player.getZ(),
            "yaw", player.getYaw(),
            "pitch", player.getPitch(),
            "onGround", player.isOnGround()
        );
    }

    private Map<String, Object> rotationMap(ClientPlayerEntity player) {
        return Map.of("yaw", player.getYaw(), "pitch", player.getPitch());
    }

    private LinkedHashMap<String, Object> currentMousePosition() {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        result.put("x", rawToScaledX(client.mouse.getX()));
        result.put("y", rawToScaledY(client.mouse.getY()));
        return result;
    }

    private Map<String, Object> blockPosMap(BlockPos pos) {
        return Map.of("x", pos.getX(), "y", pos.getY(), "z", pos.getZ());
    }

    private Entity findEntity(Map<String, Object> filter) {
        ClientPlayerEntity player = requirePlayer();
        Integer requestedId = filter.containsKey("id") ? asInt(filter.get("id")) : null;
        String type = filter.containsKey("type") ? normalizeEntityType(String.valueOf(filter.get("type"))) : null;
        String namePattern = filter.containsKey("name") ? String.valueOf(filter.get("name")) : null;
        Double maxDistance = filter.containsKey("maxDistance") ? asDouble(filter.get("maxDistance")) : null;
        boolean nearest = filter.containsKey("nearest") && Boolean.TRUE.equals(filter.get("nearest"));

        List<Entity> entities = new ArrayList<>();
        for (Entity entity : player.clientWorld.getEntities()) {
            if (entity == player) {
                continue;
            }
            if (!isEntitySelectable(entity)) {
                continue;
            }
            if (requestedId != null && entity.getId() != requestedId) {
                continue;
            }
            if (type != null && !normalizeEntityType(String.valueOf(Registries.ENTITY_TYPE.getId(entity.getType()))).equals(type)) {
                continue;
            }
            if (namePattern != null && !entity.getName().getString().matches(namePattern) && !entity.getName().getString().contains(namePattern)) {
                continue;
            }
            if (maxDistance != null && player.distanceTo(entity) > maxDistance.floatValue()) {
                continue;
            }
            entities.add(entity);
        }

        if (entities.isEmpty()) {
            throw new ActionException("ENTITY_NOT_FOUND");
        }
        entities.sort(Comparator.comparingDouble(player::distanceTo));
        return nearest || entities.size() == 1 ? entities.get(0) : entities.get(0);
    }

    private int countEntities(Map<String, Object> filter) {
        ClientPlayerEntity player = requirePlayer();
        String type = filter.containsKey("type") ? normalizeEntityType(String.valueOf(filter.get("type"))) : null;
        Double maxDistance = filter.containsKey("maxDistance") ? asDouble(filter.get("maxDistance")) : null;
        int count = 0;
        for (Entity entity : player.clientWorld.getEntities()) {
            if (entity == player) {
                continue;
            }
            if (!isEntitySelectable(entity)) {
                continue;
            }
            if (type != null && !normalizeEntityType(String.valueOf(Registries.ENTITY_TYPE.getId(entity.getType()))).equals(type)) {
                continue;
            }
            if (maxDistance != null && player.distanceTo(entity) > maxDistance.floatValue()) {
                continue;
            }
            count++;
        }
        return count;
    }

    private Map<String, Object> currentTargetState(Map<String, Object> filter) {
        return runOnClientThread(() -> currentTargetStateOnClientThread(filter));
    }

    private Map<String, Object> currentTargetStateOnClientThread(Map<String, Object> filter) {
        try {
            Entity entity = findEntity(filter);
            if (!isEntitySelectable(entity)) {
                return Map.of();
            }
            return Map.of(
                "entityId", entity.getId(),
                "x", entity.getX(),
                "y", entity.getY(),
                "z", entity.getZ(),
                "distance", requirePlayer().distanceTo(entity)
            );
        } catch (ActionException exception) {
            if ("ENTITY_NOT_FOUND".equals(exception.getCode())) {
                return Map.of();
            }
            throw exception;
        }
    }

    private Map<String, Object> nearestItemEntity(double radius) {
        ClientPlayerEntity player = requirePlayer();
        ItemEntity nearest = null;
        for (Entity entity : player.clientWorld.getEntities()) {
            if (!(entity instanceof ItemEntity itemEntity)) {
                continue;
            }
            if (player.distanceTo(itemEntity) > radius) {
                continue;
            }
            if (nearest == null || player.distanceTo(itemEntity) < player.distanceTo(nearest)) {
                nearest = itemEntity;
            }
        }
        if (nearest == null) {
            return Map.of();
        }
        return Map.of(
            "entityId", nearest.getId(),
            "x", nearest.getX(),
            "y", nearest.getY(),
            "z", nearest.getZ(),
            "item", ClientDataHelper.itemToMap(nearest.getStack())
        );
    }

    private boolean isEntitySelectable(@Nullable Entity entity) {
        if (entity == null || !entity.isAlive()) {
            return false;
        }
        if (entity instanceof LivingEntity living && living.getHealth() <= 0.0F) {
            return false;
        }
        return true;
    }

    private boolean targetDefeated(@Nullable Integer entityId) {
        return runOnClientThread(() -> targetDefeatedOnClientThread(entityId));
    }

    private boolean targetDefeatedOnClientThread(@Nullable Integer entityId) {
        if (entityId == null) {
            return false;
        }
        return !isEntitySelectable(requirePlayer().clientWorld.getEntityById(entityId));
    }

    private boolean waitForCombatTargetDefeat(@Nullable Integer entityId, Map<String, Object> filter, double timeoutSeconds) {
        if (entityId == null || timeoutSeconds <= 0.0D) {
            return false;
        }
        Boolean defeated = pollUntil(
            timeoutSeconds,
            () -> targetDefeatedOnClientThread(entityId) || currentTargetStateOnClientThread(filter).isEmpty(),
            Boolean::booleanValue
        );
        return Boolean.TRUE.equals(defeated);
    }


    private Map<String, Object> requireFilter(Map<String, Object> params) {
        Object filter = getRequired(params, "filter");
        if (!(filter instanceof Map<?, ?> rawFilter)) {
            throw new ActionException("INVALID_PARAMS");
        }
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        rawFilter.forEach((key, value) -> result.put(String.valueOf(key), value));
        return result;
    }

    private Direction inferHitSide(BlockPos pos) {
        Vec3d eye = requirePlayer().getEyePos();
        Vec3d delta = Vec3d.ofCenter(pos).subtract(eye);
        return Direction.getFacing(delta.x, delta.y, delta.z);
    }

    private BlockPos blockPos(Map<String, Object> params) {
        return new BlockPos(getInt(params, "x"), getInt(params, "y"), getInt(params, "z"));
    }

    private SignBlockEntity requireSign(Map<String, Object> params) {
        BlockEntity blockEntity = requirePlayer().clientWorld.getBlockEntity(blockPos(params));
        if (!(blockEntity instanceof SignBlockEntity sign)) {
            throw new ActionException("BLOCK_NOT_FOUND");
        }
        return sign;
    }

    private ItemStack requireBookStack() {
        ItemStack stack = requirePlayer().getMainHandStack();
        if (stack.isOf(Items.WRITABLE_BOOK) || stack.isOf(Items.WRITTEN_BOOK)) {
            return stack;
        }
        throw new ActionException("INVALID_STATE");
    }

    private ItemStack requireWritableBook(ItemStack stack) {
        if (!stack.isOf(Items.WRITABLE_BOOK)) {
            throw new ActionException("INVALID_STATE");
        }
        return stack;
    }

    private ServerResourcePackLoader requireResourcePackLoader() {
        ServerResourcePackLoader loader = client.getServerResourcePackProvider();
        if (loader == null) {
            throw new ActionException("INVALID_STATE");
        }
        return loader;
    }

    private HandledScreen<?> requireHandledScreen() {
        if (!(client.currentScreen instanceof HandledScreen<?> handledScreen)) {
            throw new ActionException("GUI_NOT_OPEN");
        }
        return handledScreen;
    }

    private <T extends ScreenHandler> T requireScreenHandler(Class<T> type) {
        HandledScreen<?> screen = requireHandledScreen();
        if (!type.isInstance(screen.getScreenHandler())) {
            throw new ActionException("INVALID_STATE");
        }
        return type.cast(screen.getScreenHandler());
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
                cropped.setColor(column, row, image.getColor(x + column, y + row));
            }
        }
        return cropped;
    }

    private String normalizeItemId(String value) {
        return value.contains(":") ? value : "minecraft:" + value;
    }

    private String normalizeEntityType(String value) {
        String normalized = value.contains(":") ? value : "minecraft:" + value;
        return normalized.toLowerCase(Locale.ROOT);
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

    private Pattern compileFlexiblePattern(String value) {
        try {
            return Pattern.compile(value);
        } catch (PatternSyntaxException ignored) {
            return Pattern.compile(Pattern.quote(value));
        }
    }

    private <T> T withTemporaryModifiers(List<String> modifiers, java.util.function.Supplier<T> action) {
        ArrayList<InputBinding> acquired = new ArrayList<>();
        for (String modifier : modifiers) {
            InputBinding binding = resolveInputBinding(modifier);
            if (heldInputKeys.contains(binding.name())) {
                continue;
            }
            dispatchInputBinding(binding, GLFW.GLFW_PRESS);
            acquired.add(binding);
        }
        try {
            return action.get();
        } finally {
            for (int index = acquired.size() - 1; index >= 0; index--) {
                dispatchInputBinding(acquired.get(index), GLFW.GLFW_RELEASE);
            }
        }
    }

    private void clickMouseButton(String button) {
        dispatchMouseButton(button, GLFW.GLFW_PRESS);
        safeSleep(60L);
        dispatchMouseButton(button, GLFW.GLFW_RELEASE);
        safeSleep(40L);
    }

    private void moveMouseTo(int scaledX, int scaledY) {
        runOnClientThread(() -> {
            long window = client.getWindow().getHandle();
            double rawX = scaledToRawX(scaledX);
            double rawY = scaledToRawY(scaledY);
            GLFW.glfwSetCursorPos(window, rawX, rawY);
            ((MouseInvoker) client.mouse).mct$onCursorPos(window, rawX, rawY);
            return true;
        });
    }

    private void dispatchMouseButton(String button, int action) {
        int glfwButton = switch (normalizeMouseButton(button)) {
            case "left" -> GLFW.GLFW_MOUSE_BUTTON_LEFT;
            case "right" -> GLFW.GLFW_MOUSE_BUTTON_RIGHT;
            case "middle" -> GLFW.GLFW_MOUSE_BUTTON_MIDDLE;
            default -> throw new ActionException("INVALID_PARAMS");
        };
        runOnClientThread(() -> {
            ((MouseInvoker) client.mouse).mct$onMouseButton(client.getWindow().getHandle(), glfwButton, action, 0);
            return true;
        });
    }

    private void pressInputBinding(InputBinding binding, long holdMillis) {
        dispatchInputBinding(binding, GLFW.GLFW_PRESS);
        safeSleep(holdMillis);
        dispatchInputBinding(binding, GLFW.GLFW_RELEASE);
        safeSleep(40L);
    }

    private void dispatchInputBinding(InputBinding binding, int action) {
        if (binding.keyBinding() != null) {
            runOnClientThread(() -> {
                KeyBinding keyBinding = binding.keyBinding();
                InputUtil.Key boundKey = ((KeyBindingAccessor) keyBinding).mct$getBoundKey();
                if (action != GLFW.GLFW_RELEASE) {
                    KeyBinding.onKeyPressed(boundKey);
                }
                KeyBinding.setKeyPressed(boundKey, action != GLFW.GLFW_RELEASE);
                return true;
            });
            updateHeldInputKey(binding.name(), action != GLFW.GLFW_RELEASE);
            return;
        }

        if (binding.mouseButton() != null) {
            dispatchMouseButton(binding.name(), action);
            updateHeldInputKey(binding.name(), action != GLFW.GLFW_RELEASE);
            return;
        }

        int keyCode = binding.keyCode();
        int scancode = GLFW.glfwGetKeyScancode(keyCode);
        runOnClientThread(() -> {
            client.keyboard.onKey(client.getWindow().getHandle(), keyCode, scancode, action, 0);
            return true;
        });
        updateHeldInputKey(binding.name(), action != GLFW.GLFW_RELEASE);
    }

    private void updateHeldInputKey(String key, boolean pressed) {
        if (pressed) {
            heldInputKeys.add(key);
        } else {
            heldInputKeys.remove(key);
        }
    }

    private List<String> snapshotHeldInputKeys() {
        synchronized (heldInputKeys) {
            return heldInputKeys.stream().sorted().toList();
        }
    }

    private InputBinding resolveInputBinding(String keyName) {
        String normalized = normalizeInputName(keyName);
        if (normalized.length() == 1) {
            char value = normalized.charAt(0);
            if (value >= 'a' && value <= 'z') {
                return new InputBinding(normalized, GLFW.GLFW_KEY_A + (value - 'a'), null);
            }
            if (value >= '0' && value <= '9') {
                return new InputBinding(normalized, GLFW.GLFW_KEY_0 + (value - '0'), null);
            }
        }
        if (normalized.startsWith("f") && normalized.length() <= 3) {
            try {
                int functionIndex = Integer.parseInt(normalized.substring(1));
                if (functionIndex >= 1 && functionIndex <= 12) {
                    return new InputBinding(normalized, GLFW.GLFW_KEY_F1 + (functionIndex - 1), null);
                }
            } catch (NumberFormatException ignored) {
            }
        }
        return switch (normalized) {
            case "space" -> new InputBinding("space", GLFW.GLFW_KEY_SPACE, null);
            case "shift" -> new InputBinding("shift", GLFW.GLFW_KEY_LEFT_SHIFT, null);
            case "ctrl", "control" -> new InputBinding("ctrl", GLFW.GLFW_KEY_LEFT_CONTROL, null);
            case "alt" -> new InputBinding("alt", GLFW.GLFW_KEY_LEFT_ALT, null);
            case "tab" -> new InputBinding("tab", GLFW.GLFW_KEY_TAB, null);
            case "escape", "esc" -> new InputBinding("escape", GLFW.GLFW_KEY_ESCAPE, null);
            case "enter", "return" -> new InputBinding("enter", GLFW.GLFW_KEY_ENTER, null);
            case "backspace" -> new InputBinding("backspace", GLFW.GLFW_KEY_BACKSPACE, null);
            case "delete" -> new InputBinding("delete", GLFW.GLFW_KEY_DELETE, null);
            case "up" -> new InputBinding("up", GLFW.GLFW_KEY_UP, null);
            case "down" -> new InputBinding("down", GLFW.GLFW_KEY_DOWN, null);
            case "left" -> new InputBinding("left", GLFW.GLFW_KEY_LEFT, null);
            case "right" -> new InputBinding("right", GLFW.GLFW_KEY_RIGHT, null);
            case "minus" -> new InputBinding("minus", GLFW.GLFW_KEY_MINUS, null);
            case "equals" -> new InputBinding("equals", GLFW.GLFW_KEY_EQUAL, null);
            case "left-bracket" -> new InputBinding("left-bracket", GLFW.GLFW_KEY_LEFT_BRACKET, null);
            case "right-bracket" -> new InputBinding("right-bracket", GLFW.GLFW_KEY_RIGHT_BRACKET, null);
            case "slash" -> new InputBinding("slash", GLFW.GLFW_KEY_SLASH, null);
            case "inventory" -> new InputBinding("inventory", client.options.inventoryKey);
            case "drop" -> new InputBinding("drop", client.options.dropKey);
            case "sprint" -> new InputBinding("sprint", client.options.sprintKey);
            case "sneak" -> new InputBinding("sneak", client.options.sneakKey);
            case "attack" -> new InputBinding("left", null, Integer.valueOf(GLFW.GLFW_MOUSE_BUTTON_LEFT), null);
            case "use" -> new InputBinding("right", null, Integer.valueOf(GLFW.GLFW_MOUSE_BUTTON_RIGHT), null);
            case "middle", "pick" -> new InputBinding("middle", null, Integer.valueOf(GLFW.GLFW_MOUSE_BUTTON_MIDDLE), null);
            default -> throw new ActionException("INVALID_PARAMS");
        };
    }

    private String normalizeMouseButton(String button) {
        return switch (normalizeInputName(button)) {
            case "left", "attack" -> "left";
            case "right", "use" -> "right";
            case "middle", "pick" -> "middle";
            default -> throw new ActionException("INVALID_PARAMS");
        };
    }

    private String normalizeInputName(String value) {
        return value.toLowerCase(Locale.ROOT).trim();
    }

    private double scaledToRawX(double scaledX) {
        return scaledX * ((double) client.getWindow().getWidth() / (double) client.getWindow().getScaledWidth());
    }

    private double scaledToRawY(double scaledY) {
        return scaledY * ((double) client.getWindow().getHeight() / (double) client.getWindow().getScaledHeight());
    }

    private double rawToScaledX(double rawX) {
        return rawX * ((double) client.getWindow().getScaledWidth() / (double) client.getWindow().getWidth());
    }

    private double rawToScaledY(double rawY) {
        return rawY * ((double) client.getWindow().getScaledHeight() / (double) client.getWindow().getHeight());
    }

    private <T> T pollOnClientThread(double timeoutSeconds, java.util.function.Supplier<T> supplier, java.util.function.Predicate<T> done, String timeoutCode) {
        long deadline = System.currentTimeMillis() + (long) (timeoutSeconds * 1000.0D);
        T latest = null;
        while (System.currentTimeMillis() < deadline) {
            latest = runOnClientThread(supplier::get);
            if (done.test(latest)) {
                return latest;
            }
            safeSleep(100L);
        }
        throw new ActionException(timeoutCode);
    }

    private <T> T pollUntil(double timeoutSeconds, java.util.function.Supplier<T> supplier, java.util.function.Predicate<T> done) {
        long deadline = System.currentTimeMillis() + (long) (timeoutSeconds * 1000.0D);
        T latest = null;
        while (System.currentTimeMillis() < deadline) {
            latest = runOnClientThread(supplier::get);
            if (done.test(latest)) {
                return latest;
            }
            safeSleep(100L);
        }
        return latest;
    }

    private <T> T runOnClientThread(Task<T> task) {
        CompletableFuture<T> future = new CompletableFuture<>();
        client.execute(() -> {
            try {
                future.complete(task.run());
            } catch (Exception exception) {
                future.completeExceptionally(exception);
            }
        });

        try {
            return future.get(30, TimeUnit.SECONDS);
        } catch (Exception exception) {
            Throwable cause = exception.getCause();
            if (cause instanceof ActionException actionException) {
                throw actionException;
            }
            throw new ActionException("INTERNAL_ERROR");
        }
    }

    private ClientPlayerEntity requirePlayer() {
        ClientPlayerEntity player = client.player;
        ClientPlayNetworkHandler networkHandler = player != null ? player.networkHandler : null;
        if (player == null || networkHandler == null || player.clientWorld == null) {
            throw new ActionException("NOT_IN_WORLD");
        }
        return player;
    }

    private ClientPlayerInteractionManager requireInteractionManager() {
        ClientPlayerInteractionManager interactionManager = client.interactionManager;
        if (interactionManager == null) {
            throw new ActionException("NOT_IN_WORLD");
        }
        return interactionManager;
    }

    private Object getRequired(Map<String, Object> params, String key) {
        if (params == null || !params.containsKey(key) || params.get(key) == null) {
            throw new ActionException("INVALID_PARAMS");
        }
        return params.get(key);
    }

    private String getString(Map<String, Object> params, String key) {
        return String.valueOf(getRequired(params, key));
    }

    private String getString(Map<String, Object> params, String key, String defaultValue) {
        return params != null && params.containsKey(key) && params.get(key) != null ? String.valueOf(params.get(key)) : defaultValue;
    }

    @Nullable
    private String getOptionalString(Map<String, Object> params, String key) {
        return params != null && params.containsKey(key) && params.get(key) != null ? String.valueOf(params.get(key)) : null;
    }

    private int getInt(Map<String, Object> params, String key) {
        return asInt(getRequired(params, key));
    }

    private int getInt(Map<String, Object> params, String key, int defaultValue) {
        return params != null && params.containsKey(key) && params.get(key) != null ? asInt(params.get(key)) : defaultValue;
    }

    private double getDouble(Map<String, Object> params, String key) {
        return asDouble(getRequired(params, key));
    }

    private double getDouble(Map<String, Object> params, String key, double defaultValue) {
        return params != null && params.containsKey(key) && params.get(key) != null ? asDouble(params.get(key)) : defaultValue;
    }

    private boolean getBoolean(Map<String, Object> params, String key, boolean defaultValue) {
        if (params == null || !params.containsKey(key) || params.get(key) == null) {
            return defaultValue;
        }
        Object value = params.get(key);
        if (value instanceof Boolean booleanValue) {
            return booleanValue;
        }
        if (value instanceof Number number) {
            return number.intValue() != 0;
        }
        return Boolean.parseBoolean(String.valueOf(value));
    }

    @SuppressWarnings("unchecked")
    private List<Object> getList(Map<String, Object> params, String key) {
        Object value = getRequired(params, key);
        if (value instanceof List<?> list) {
            return (List<Object>) list;
        }
        throw new ActionException("INVALID_PARAMS");
    }

    private List<String> getStringList(Map<String, Object> params, String key) {
        if (params == null || !params.containsKey(key) || params.get(key) == null) {
            return List.of();
        }
        return getList(params, key).stream()
            .map(String::valueOf)
            .map(this::normalizeInputName)
            .filter(value -> !value.isEmpty())
            .toList();
    }

    private int asInt(Object value) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        return Integer.parseInt(String.valueOf(value));
    }

    private double asDouble(Object value) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        return Double.parseDouble(String.valueOf(value));
    }

    private double elapsedSeconds(Instant startedAt) {
        return Duration.between(startedAt, Instant.now()).toMillis() / 1000.0D;
    }

    private String stripLeadingSlash(String command) {
        return command.startsWith("/") ? command.substring(1) : command;
    }

    private void safeSleep(long milliseconds) {
        try {
            Thread.sleep(milliseconds);
        } catch (InterruptedException interruptedException) {
            Thread.currentThread().interrupt();
        }
    }

    private record ClickPlan(int button, SlotActionType actionType) {
    }

    private record InputBinding(String name, @Nullable Integer keyCode, @Nullable Integer mouseButton, @Nullable KeyBinding keyBinding) {

        private InputBinding(String name, int keyCode, @Nullable Integer mouseButton) {
            this(name, Integer.valueOf(keyCode), mouseButton, null);
        }

        private InputBinding(String name, KeyBinding keyBinding) {
            this(name, null, null, keyBinding);
        }
    }

    @FunctionalInterface
    private interface Task<T> {
        T run();
    }

    public static final class ActionException extends RuntimeException {

        private final String code;

        public ActionException(String code) {
            this.code = code;
        }

        public String getCode() {
            return code;
        }
    }
}
