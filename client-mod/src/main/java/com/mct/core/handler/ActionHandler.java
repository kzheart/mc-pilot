package com.mct.core.handler;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.core.util.ClientDataHelper;
import com.mct.core.util.ParamHelper;
import com.mct.version.ClientVersionModulesHolder;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.ingame.HandledScreen;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.network.ClientPlayerInteractionManager;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;
import org.jetbrains.annotations.Nullable;

public abstract class ActionHandler {

    protected final MinecraftClient client;
    protected final ClientStateTracker stateTracker;

    protected ActionHandler(MinecraftClient client, ClientStateTracker stateTracker) {
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

    // --- Require helpers ---

    protected ClientPlayerEntity requirePlayer() {
        ClientPlayerEntity player = client.player;
        if (player == null || player.networkHandler == null || player.clientWorld == null) {
            throw new ActionException("NOT_IN_WORLD");
        }
        return player;
    }

    protected ClientPlayerInteractionManager requireInteractionManager() {
        ClientPlayerInteractionManager interactionManager = client.interactionManager;
        if (interactionManager == null) {
            throw new ActionException("NOT_IN_WORLD");
        }
        return interactionManager;
    }

    protected HandledScreen<?> requireHandledScreen() {
        if (!(client.currentScreen instanceof HandledScreen<?> handledScreen)) {
            throw new ActionException("GUI_NOT_OPEN");
        }
        return handledScreen;
    }

    protected <T extends ScreenHandler> T requireScreenHandler(Class<T> type) {
        HandledScreen<?> screen = requireHandledScreen();
        if (!type.isInstance(screen.getScreenHandler())) {
            throw new ActionException("INVALID_STATE");
        }
        return type.cast(screen.getScreenHandler());
    }

    // --- Data conversion helpers ---

    protected Map<String, Object> positionMap(ClientPlayerEntity player) {
        return Map.of(
            "x", player.getX(),
            "y", player.getY(),
            "z", player.getZ(),
            "yaw", player.getYaw(),
            "pitch", player.getPitch(),
            "onGround", player.isOnGround()
        );
    }

    protected Map<String, Object> rotationMap(ClientPlayerEntity player) {
        return Map.of("yaw", player.getYaw(), "pitch", player.getPitch());
    }

    protected Map<String, Object> blockPosMap(BlockPos pos) {
        return Map.of("x", pos.getX(), "y", pos.getY(), "z", pos.getZ());
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
