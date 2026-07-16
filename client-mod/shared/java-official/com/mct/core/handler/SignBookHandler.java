package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.getList;
import static com.mct.core.util.ParamHelper.getString;

import com.mct.core.network.PacketSender;
import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.core.util.ClientDataHelper;
import com.mct.version.ClientVersionModulesHolder;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.protocol.game.ServerboundEditBookPacket;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.SignBlockEntity;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

public final class SignBookHandler extends ActionHandler {

    private static final long BOOK_UPDATE_COOLDOWN_MILLIS = 1500L;

    private volatile long lastBookUpdateAt;

    public SignBookHandler(Minecraft client, ClientStateTracker stateTracker) {
        super(client, stateTracker);
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
            case "sign.read" -> runOnClientThread(() -> readSign(params));
            case "sign.edit" -> editSign(params);
            case "book.read" -> runOnClientThread(this::readBook);
            case "book.write" -> writeBook(params);
            case "book.sign" -> signBook(params);
            default -> throw new ActionException("INVALID_ACTION");
        };
    }

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
            BlockPos target = sign.getBlockPos();
            if (!ClientVersionModulesHolder.get().sign().isSignEditScreen(ClientVersionModulesHolder.get().compatibility().getScreen(client))) {
                LocalPlayer player = requirePlayer();
                ClientVersionModulesHolder.get().interaction().interactBlock(
                    requireInteractionManager(), player, InteractionHand.MAIN_HAND,
                    new BlockHitResult(Vec3.atCenterOf(target), inferHitSide(target), target, false)
                );
            }
            return target;
        });

        pollUntil(3.0D, () -> ClientVersionModulesHolder.get().sign().isSignEditScreen(ClientVersionModulesHolder.get().compatibility().getScreen(client)), Boolean::booleanValue);

        runOnClientThread(() -> {
            LocalPlayer player = requirePlayer();
            if (ClientVersionModulesHolder.get().sign().isSignEditScreen(ClientVersionModulesHolder.get().compatibility().getScreen(client))) {
                Object accessor = ClientVersionModulesHolder.get().compatibility().getScreen(client);
                for (int index = 0; index < values.length; index++) {
                    ClientVersionModulesHolder.get().sign().editSignLine(accessor, index, values[index]);
                }
                ClientVersionModulesHolder.get().compatibility().setScreen(client, null);
            }
            ClientVersionModulesHolder.get().sign().sendSignUpdate(player, pos, values);
            return true;
        });

        return pollOnClientThread(
            3.0D,
            () -> {
                SignBlockEntity sign = requireSign(com.mct.core.util.MctMaps.mapOf("x", pos.getX(), "y", pos.getY(), "z", pos.getZ()));
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

    private Map<String, Object> readBook() {
        ItemStack stack = requireBookStack();
        List<String> pages = ClientVersionModulesHolder.get().book().readPages(stack);
        return com.mct.core.util.MctMaps.mapOf("pages", pages, "item", ClientDataHelper.itemToMap(stack));
    }

    private Map<String, Object> writeBook(Map<String, Object> params) {
        List<String> pages = getList(params, "pages").stream().map(String::valueOf).collect(Collectors.toList());
        waitForBookUpdateCooldown();
        Map<String, Object> result = runOnClientThread(() -> {
            LocalPlayer player = requirePlayer();
            ItemStack stack = requireWritableBook(player.getMainHandItem());
            PacketSender.send(player.connection, new ServerboundEditBookPacket(ClientVersionModulesHolder.get().compatibility().getSelectedSlot(player.getInventory()), pages, Optional.empty()));
            lastBookUpdateAt = System.currentTimeMillis();
            return com.mct.core.util.MctMaps.mapOf("written", true, "pages", pages, "item", ClientDataHelper.itemToMap(stack));
        });
        safeSleep(BOOK_UPDATE_COOLDOWN_MILLIS);
        return result;
    }

    private Map<String, Object> signBook(Map<String, Object> params) {
        String title = getString(params, "title");
        waitForBookUpdateCooldown();
        Map<String, Object> result = runOnClientThread(() -> {
            LocalPlayer player = requirePlayer();
            ItemStack stack = requireWritableBook(player.getMainHandItem());
            List<String> pages = ClientVersionModulesHolder.get().book().readPages(stack);
            PacketSender.send(player.connection, new ServerboundEditBookPacket(ClientVersionModulesHolder.get().compatibility().getSelectedSlot(player.getInventory()), pages, Optional.of(title)));
            lastBookUpdateAt = System.currentTimeMillis();
            return com.mct.core.util.MctMaps.mapOf("signed", true, "title", title, "author", getString(params, "author", player.getName().getString()));
        });
        safeSleep(BOOK_UPDATE_COOLDOWN_MILLIS);
        return result;
    }

    private Direction inferHitSide(BlockPos pos) {
        Vec3 eye = requirePlayer().getEyePosition();
        Vec3 delta = Vec3.atCenterOf(pos).subtract(eye);
        return Direction.getApproximateNearest(delta.x, delta.y, delta.z);
    }

    private SignBlockEntity requireSign(Map<String, Object> params) {
        BlockEntity blockEntity = clientWorld(requirePlayer()).getBlockEntity(blockPos(params));
        if (!(blockEntity instanceof SignBlockEntity sign)) {
            throw new ActionException("BLOCK_NOT_FOUND");
        }
        return sign;
    }

    private ItemStack requireBookStack() {
        ItemStack stack = requirePlayer().getMainHandItem();
        if (stack.is(Items.WRITABLE_BOOK) || stack.is(Items.WRITTEN_BOOK)) {
            return stack;
        }
        throw new ActionException("INVALID_STATE");
    }

    private ItemStack requireWritableBook(ItemStack stack) {
        if (!stack.is(Items.WRITABLE_BOOK)) {
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
}
