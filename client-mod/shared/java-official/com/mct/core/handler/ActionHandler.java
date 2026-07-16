package com.mct.core.handler;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.core.util.ClientDataHelper;
import com.mct.core.util.ParamHelper;
import com.mct.core.util.SessionReliability;
import com.mct.version.ClientVersionModulesHolder;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.inventory.AbstractContainerMenu;
import org.jetbrains.annotations.Nullable;

public abstract class ActionHandler {

    protected final Minecraft client;
    protected final ClientStateTracker stateTracker;

    protected ActionHandler(Minecraft client, ClientStateTracker stateTracker) {
        this.client = client;
        this.stateTracker = stateTracker;
    }

    public abstract Map<String, Object> handle(String action, Map<String, Object> params);

    // --- Client thread helpers ---

    protected <T> T runOnClientThread(Task<T> task) {
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

    protected <T> T pollOnClientThread(double timeoutSeconds, java.util.function.Supplier<T> supplier, java.util.function.Predicate<T> done, String timeoutCode) {
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

    protected <T> T pollUntil(double timeoutSeconds, java.util.function.Supplier<T> supplier, java.util.function.Predicate<T> done) {
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

    protected <T> T waitForCondition(Map<String, Object> params, java.util.function.Supplier<T> supplier, java.util.function.Predicate<T> done) {
        double waitSeconds = ParamHelper.getDouble(params, "wait", 0.0D);
        if (waitSeconds <= 0.0D) {
            return runOnClientThread(supplier::get);
        }
        return pollOnClientThread(waitSeconds, supplier, done, "TIMEOUT");
    }

    // --- Require helpers ---

    protected LocalPlayer requirePlayer() {
        LocalPlayer player = client.player;
        if (player == null || player.connection == null || ClientVersionModulesHolder.get().clientWorld().getClientWorld(player) == null) {
            SessionReliability.tryAutoReconnect(client, stateTracker);
            throw new ActionException("NOT_IN_WORLD");
        }
        SessionReliability.markInWorld();
        return player;
    }

    protected ClientLevel clientWorld(LocalPlayer player) {
        return ClientVersionModulesHolder.get().clientWorld().getClientWorld(player);
    }

    protected ClientLevel requireClientWorld() {
        return clientWorld(requirePlayer());
    }

    protected MultiPlayerGameMode requireInteractionManager() {
        MultiPlayerGameMode interactionManager = client.gameMode;
        if (interactionManager == null) {
            throw new ActionException("NOT_IN_WORLD");
        }
        return interactionManager;
    }

    protected AbstractContainerScreen<?> requireHandledScreen() {
        if (!(ClientVersionModulesHolder.get().compatibility().getScreen(client) instanceof AbstractContainerScreen<?> handledScreen)) {
            throw new ActionException("GUI_NOT_OPEN");
        }
        return handledScreen;
    }

    protected <T extends AbstractContainerMenu> T requireScreenHandler(Class<T> type) {
        AbstractContainerScreen<?> screen = requireHandledScreen();
        if (!type.isInstance(screen.getMenu())) {
            throw new ActionException("INVALID_STATE");
        }
        return type.cast(screen.getMenu());
    }

    // --- Data conversion helpers ---

    protected Map<String, Object> positionMap(LocalPlayer player) {
        return com.mct.core.util.MctMaps.mapOf(
            "x", player.getX(),
            "y", player.getY(),
            "z", player.getZ(),
            "yaw", player.getYRot(),
            "pitch", player.getXRot(),
            "onGround", player.onGround()
        );
    }

    protected Map<String, Object> rotationMap(LocalPlayer player) {
        return com.mct.core.util.MctMaps.mapOf("yaw", player.getYRot(), "pitch", player.getXRot());
    }

    protected Map<String, Object> blockPosMap(BlockPos pos) {
        return com.mct.core.util.MctMaps.mapOf("x", pos.getX(), "y", pos.getY(), "z", pos.getZ());
    }

    protected BlockPos blockPos(Map<String, Object> params) {
        return new BlockPos(ParamHelper.getInt(params, "x"), ParamHelper.getInt(params, "y"), ParamHelper.getInt(params, "z"));
    }

    // --- Utility ---

    protected void safeSleep(long milliseconds) {
        try {
            Thread.sleep(milliseconds);
        } catch (InterruptedException interruptedException) {
            Thread.currentThread().interrupt();
        }
    }

    protected double elapsedSeconds(Instant startedAt) {
        return Duration.between(startedAt, Instant.now()).toMillis() / 1000.0D;
    }

    @FunctionalInterface
    protected interface Task<T> {
        T run();
    }
}
