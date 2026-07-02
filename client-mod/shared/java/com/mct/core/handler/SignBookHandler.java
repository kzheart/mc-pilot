package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.getList;
import static com.mct.core.util.ParamHelper.getString;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.core.util.ClientDataHelper;
import com.mct.version.ClientVersionModulesHolder;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.SignBlockEntity;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.network.packet.c2s.play.BookUpdateC2SPacket;
import net.minecraft.util.Hand;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.Vec3d;

public final class SignBookHandler extends ActionHandler {

    private static final long BOOK_UPDATE_COOLDOWN_MILLIS = 1500L;

    private volatile long lastBookUpdateAt;

    public SignBookHandler(MinecraftClient client, ClientStateTracker stateTracker) {
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
            ClientPlayerEntity player = requirePlayer();
            ItemStack stack = requireWritableBook(player.getMainHandStack());
            player.networkHandler.sendPacket(new BookUpdateC2SPacket(ClientVersionModulesHolder.get().compatibility().getSelectedSlot(player.getInventory()), pages, Optional.empty()));
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
            ClientPlayerEntity player = requirePlayer();
            ItemStack stack = requireWritableBook(player.getMainHandStack());
            List<String> pages = ClientVersionModulesHolder.get().book().readPages(stack);
            player.networkHandler.sendPacket(new BookUpdateC2SPacket(ClientVersionModulesHolder.get().compatibility().getSelectedSlot(player.getInventory()), pages, Optional.of(title)));
            lastBookUpdateAt = System.currentTimeMillis();
            return com.mct.core.util.MctMaps.mapOf("signed", true, "title", title, "author", getString(params, "author", player.getName().getString()));
        });
        safeSleep(BOOK_UPDATE_COOLDOWN_MILLIS);
        return result;
    }

    private Direction inferHitSide(BlockPos pos) {
        Vec3d eye = requirePlayer().getEyePos();
        Vec3d delta = Vec3d.ofCenter(pos).subtract(eye);
        return Direction.getFacing(delta.x, delta.y, delta.z);
    }

    private SignBlockEntity requireSign(Map<String, Object> params) {
        BlockEntity blockEntity = clientWorld(requirePlayer()).getBlockEntity(blockPos(params));
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
}
