package com.mct.legacy;

import com.google.gson.JsonObject;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Callable;
import net.minecraft.client.Minecraft;
import net.minecraft.client.entity.EntityPlayerSP;
import net.minecraft.client.gui.inventory.GuiContainer;
import net.minecraft.client.multiplayer.PlayerControllerMP;
import net.minecraft.inventory.Container;
import net.minecraft.util.math.BlockPos;

/** Base class for legacy action handlers; runs on connection threads. */
public abstract class LegacyActions implements ActionRouter.Handler {

    protected final Minecraft client = Minecraft.getMinecraft();

    protected interface Check<T> {
        boolean done(T value);
    }

    protected <T> T onClient(Callable<T> callable) {
        return MainThread.call(callable);
    }

    protected <T> T pollOnClient(double timeoutSeconds, Callable<T> supplier, Check<T> done, String timeoutCode) {
        long deadline = System.currentTimeMillis() + (long) (timeoutSeconds * 1000.0D);
        while (System.currentTimeMillis() < deadline) {
            T latest = onClient(supplier);
            if (done.done(latest)) {
                return latest;
            }
            MainThread.sleep(100L);
        }
        throw new LegacyActionException(timeoutCode);
    }

    protected <T> T pollUntil(double timeoutSeconds, Callable<T> supplier, Check<T> done) {
        long deadline = System.currentTimeMillis() + (long) (timeoutSeconds * 1000.0D);
        T latest = null;
        while (System.currentTimeMillis() < deadline) {
            latest = onClient(supplier);
            if (done.done(latest)) {
                return latest;
            }
            MainThread.sleep(100L);
        }
        return latest;
    }

    protected <T> T waitForCondition(JsonObject params, Callable<T> supplier, Check<T> done) {
        double waitSeconds = Params.doubleValue(params, "wait", 0.0D);
        if (waitSeconds <= 0.0D) {
            return onClient(supplier);
        }
        return pollOnClient(waitSeconds, supplier, done, "TIMEOUT");
    }

    protected EntityPlayerSP requirePlayer() {
        EntityPlayerSP player = client.player;
        if (player == null || player.connection == null || client.world == null) {
            throw new LegacyActionException("NOT_IN_WORLD");
        }
        return player;
    }

    protected PlayerControllerMP requireController() {
        PlayerControllerMP controller = client.playerController;
        if (controller == null) {
            throw new LegacyActionException("NOT_IN_WORLD");
        }
        return controller;
    }

    protected GuiContainer requireContainerScreen() {
        if (!(client.currentScreen instanceof GuiContainer)) {
            throw new LegacyActionException("GUI_NOT_OPEN");
        }
        return (GuiContainer) client.currentScreen;
    }

    protected <T extends Container> T requireContainer(Class<T> type) {
        Container container = requireContainerScreen().inventorySlots;
        if (!type.isInstance(container)) {
            throw new LegacyActionException("INVALID_STATE");
        }
        return type.cast(container);
    }

    protected Map<String, Object> positionMap(EntityPlayerSP player) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("x", player.posX);
        result.put("y", player.posY);
        result.put("z", player.posZ);
        result.put("yaw", player.rotationYaw);
        result.put("pitch", player.rotationPitch);
        result.put("onGround", player.onGround);
        return result;
    }

    protected Map<String, Object> rotationMap(EntityPlayerSP player) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("yaw", player.rotationYaw);
        result.put("pitch", player.rotationPitch);
        return result;
    }

    protected BlockPos blockPos(JsonObject params) {
        return new BlockPos(Params.requireInt(params, "x"), Params.requireInt(params, "y"), Params.requireInt(params, "z"));
    }

    protected Map<String, Object> map(Object... pairs) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        for (int index = 0; index < pairs.length; index += 2) {
            result.put(String.valueOf(pairs[index]), pairs[index + 1]);
        }
        return result;
    }

    protected double elapsedSeconds(long startedAtMillis) {
        return (System.currentTimeMillis() - startedAtMillis) / 1000.0D;
    }
}
