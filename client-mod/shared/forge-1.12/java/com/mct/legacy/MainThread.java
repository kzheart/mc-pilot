package com.mct.legacy;

import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import net.minecraft.client.Minecraft;

/** Runs code on the client main thread from WebSocket connection threads. */
public final class MainThread {

    private MainThread() {
    }

    public static <T> T call(Callable<T> callable) {
        return call(callable, 10_000L);
    }

    public static <T> T call(Callable<T> callable, long timeoutMillis) {
        Minecraft client = Minecraft.getMinecraft();
        if (client.isCallingFromMinecraftThread()) {
            try {
                return callable.call();
            } catch (RuntimeException exception) {
                throw exception;
            } catch (Exception exception) {
                throw new RuntimeException(exception);
            }
        }
        try {
            return client.addScheduledTask(callable).get(timeoutMillis, TimeUnit.MILLISECONDS);
        } catch (ExecutionException exception) {
            if (exception.getCause() instanceof LegacyActionException) {
                throw (LegacyActionException) exception.getCause();
            }
            throw new RuntimeException(exception.getCause());
        } catch (TimeoutException exception) {
            throw new LegacyActionException("TIMEOUT");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new LegacyActionException("INTERNAL_ERROR", "interrupted");
        }
    }

    public static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new LegacyActionException("INTERNAL_ERROR", "interrupted");
        }
    }
}
