package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.*;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.core.util.ClientDataHelper;
import com.mct.version.ClientVersionModulesHolder;
import com.mct.version.McRegistries;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.SignBlockEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ClientPlayerInteractionManager;
import net.minecraft.entity.Entity;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.network.packet.c2s.play.BookUpdateC2SPacket;
import net.minecraft.network.packet.c2s.play.RenameItemC2SPacket;
import net.minecraft.network.packet.c2s.play.SelectMerchantTradeC2SPacket;
import net.minecraft.screen.AnvilScreenHandler;
import net.minecraft.screen.CraftingScreenHandler;
import net.minecraft.screen.EnchantmentScreenHandler;
import net.minecraft.screen.MerchantScreenHandler;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.slot.SlotActionType;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.Vec3d;
import org.jetbrains.annotations.Nullable;

public final class WorldHandler extends ActionHandler {

    private static final long BOOK_UPDATE_COOLDOWN_MILLIS = 1500L;

    private final MovementHandler movementHandler;
    private final InputHandler inputHandler;
    private volatile long lastBookUpdateAt;

    public WorldHandler(MinecraftClient client, ClientStateTracker stateTracker, MovementHandler movementHandler, InputHandler inputHandler) {
        super(client, stateTracker);
        this.movementHandler = movementHandler;
        this.inputHandler = inputHandler;
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
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

    // --- Sign ---

    private Map<String, Object> readSign(Map<String, Object> params) {
        SignBlockEntity sign = requireSign(params);
        return ClientVersionModulesHolder.get().sign().readSign(sign);
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
            if (!ClientVersionModulesHolder.get().sign().isSignEditScreen(client.currentScreen)) {
                ClientPlayerEntity player = requirePlayer();
                ClientVersionModulesHolder.get().interaction().interactBlock(
                    requireInteractionManager(), player, Hand.MAIN_HAND,
                    new BlockHitResult(Vec3d.ofCenter(target), inferHitSide(target), target, false)
                );
            }
            return target;
        });

        pollOnClientThread(3.0D, () -> ClientVersionModulesHolder.get().sign().isSignEditScreen(client.currentScreen), Boolean::booleanValue, "TIMEOUT");

        runOnClientThread(() -> {
            if (!ClientVersionModulesHolder.get().sign().isSignEditScreen(client.currentScreen)) {
                throw new ActionException("INVALID_STATE");
            }
            Object accessor = client.currentScreen;
            for (int index = 0; index < values.length; index++) {
                ClientVersionModulesHolder.get().sign().editSignLine(accessor, index, values[index]);
            }
            client.setScreen(null);
            return true;
        });

        return pollOnClientThread(
            3.0D,
            () -> {
                SignBlockEntity sign = requireSign(Map.of("x", pos.getX(), "y", pos.getY(), "z", pos.getZ()));
                return ClientVersionModulesHolder.get().sign().readSign(sign);
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

    // --- Book ---

    private Map<String, Object> readBook() {
        ItemStack stack = requireBookStack();
        List<String> pages = ClientVersionModulesHolder.get().book().readPages(stack);
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
            List<String> pages = ClientVersionModulesHolder.get().book().readPages(stack);
            player.networkHandler.sendPacket(new BookUpdateC2SPacket(player.getInventory().selectedSlot, pages, Optional.of(title)));
            lastBookUpdateAt = System.currentTimeMillis();
            return Map.of("signed", true, "title", title, "author", getString(params, "author", player.getName().getString()));
        });
        safeSleep(BOOK_UPDATE_COOLDOWN_MILLIS);
        return result;
    }

    // --- Block ---

    private Map<String, Object> getBlock(Map<String, Object> params) {
        BlockPos pos = blockPos(params);
        var world = requirePlayer().clientWorld;
        var state = world.getBlockState(pos);
        LinkedHashMap<String, Object> properties = new LinkedHashMap<>();
        state.getEntries().forEach((property, value) -> properties.put(property.getName(), String.valueOf(value)));
        return Map.of(
            "type", String.valueOf(McRegistries.blockId(state.getBlock())),
            "properties", properties,
            "lightLevel", world.getLightLevel(pos)
        );
    }

    private Map<String, Object> interactBlock(Map<String, Object> params) {
        ClientPlayerEntity player = requirePlayer();
        BlockPos pos = blockPos(params);
        Direction face = inferHitSide(pos);
        ActionResult result = ClientVersionModulesHolder.get().interaction().interactBlock(
            requireInteractionManager(), player, Hand.MAIN_HAND,
            new BlockHitResult(Vec3d.ofCenter(pos), face, pos, false)
        );
        return Map.of("success", result.isAccepted(), "resultAction", ClientVersionModulesHolder.get().actionResult().resultName(result));
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
        ActionResult result = ClientVersionModulesHolder.get().interaction().interactBlock(requireInteractionManager(), player, Hand.MAIN_HAND, hit);
        Instant startedAt = Instant.now();
        while (Duration.between(startedAt, Instant.now()).toMillis() < 2_000L) {
            String placedType = String.valueOf(McRegistries.blockId(requirePlayer().clientWorld.getBlockState(target).getBlock()));
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
            "placedType", String.valueOf(McRegistries.blockId(requirePlayer().clientWorld.getBlockState(target).getBlock()))
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
            "blockType", runOnClientThread(() -> String.valueOf(McRegistries.blockId(requirePlayer().clientWorld.getBlockState(pos).getBlock()))),
            "duration", Duration.between(startedAt, Instant.now()).toMillis()
        );
    }

    // --- Entity ---

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
        Entity entity = EntityHelper.findEntity(player, requireFilter(params));
        requireInteractionManager().attackEntity(player, entity);
        player.swingHand(Hand.MAIN_HAND);
        return Map.of("success", true, "entityId", entity.getId(), "entityType", String.valueOf(McRegistries.entityTypeId(entity.getType())));
    }

    private Map<String, Object> interactEntity(Map<String, Object> params) {
        ClientPlayerEntity player = requirePlayer();
        Entity entity = EntityHelper.findEntity(player, requireFilter(params));
        ActionResult result = requireInteractionManager().interactEntity(player, entity, Hand.MAIN_HAND);
        return Map.of("success", result.isAccepted(), "entityId", entity.getId(), "entityType", String.valueOf(McRegistries.entityTypeId(entity.getType())));
    }

    private Map<String, Object> mountEntity(Map<String, Object> params) {
        Map<String, Object> interaction = runOnClientThread(() -> {
            ClientPlayerEntity player = requirePlayer();
            Entity entity = EntityHelper.findEntity(player, requireFilter(params));
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
        inputHandler.pressMovementKeys(forward, back, left, right, jump, sneak, 300L);
        return runOnClientThread(() -> Map.of("newPos", positionMap(requirePlayer())));
    }

    // --- Combat ---

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
        String type = EntityHelper.normalizeEntityType(getString(params, "type"));
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

        int remaining = runOnClientThread(() -> EntityHelper.countEntities(requirePlayer(), Map.of("type", type, "maxDistance", radius)));
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
            movementHandler.moveTo(Map.of("x", next.get("x"), "y", next.get("y"), "z", next.get("z"), "timeout", remainingTimeout));
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
                movementHandler.lookAt(player, entity.getX(), entity.getEyeY(), entity.getZ());
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

        movementHandler.moveTo(nextStep);
    }

    // --- Craft ---

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

    // --- Helpers ---

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

    private void waitForBookUpdateCooldown() {
        long remaining = BOOK_UPDATE_COOLDOWN_MILLIS - (System.currentTimeMillis() - lastBookUpdateAt);
        if (remaining > 0L) {
            safeSleep(remaining);
        }
    }

    private Map<String, Object> currentTargetState(Map<String, Object> filter) {
        return runOnClientThread(() -> currentTargetStateOnClientThread(filter));
    }

    private Map<String, Object> currentTargetStateOnClientThread(Map<String, Object> filter) {
        try {
            Entity entity = EntityHelper.findEntity(requirePlayer(), filter);
            if (!EntityHelper.isEntitySelectable(entity)) {
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

    private boolean targetDefeatedOnClientThread(@Nullable Integer entityId) {
        if (entityId == null) {
            return false;
        }
        return !EntityHelper.isEntitySelectable(requirePlayer().clientWorld.getEntityById(entityId));
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
