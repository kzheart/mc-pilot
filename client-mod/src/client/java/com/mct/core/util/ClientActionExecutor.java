package com.mct.core.util;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayNetworkHandler;
import net.minecraft.client.network.ClientPlayerEntity;

public final class ClientActionExecutor {

    private final MinecraftClient client;

    public ClientActionExecutor(MinecraftClient client) {
        this.client = client;
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
                player.networkHandler.sendChatCommand(stripLeadingSlash(getString(params, "command")));
                return Map.of("sent", true);
            });
            case "position.get" -> runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                return Map.of(
                    "x", player.getX(),
                    "y", player.getY(),
                    "z", player.getZ(),
                    "yaw", player.getYaw(),
                    "pitch", player.getPitch(),
                    "onGround", player.isOnGround()
                );
            });
            case "wait.perform" -> {
                double seconds = params != null && params.get("seconds") != null
                    ? ((Number) params.get("seconds")).doubleValue()
                    : 0D;
                if (seconds > 0D) {
                    try {
                        Thread.sleep((long) (seconds * 1000));
                    } catch (InterruptedException interruptedException) {
                        Thread.currentThread().interrupt();
                    }
                }
                yield Map.of("waited", seconds);
            }
            default -> throw new ActionException("INVALID_PARAMS");
        };
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
            return future.get(10, TimeUnit.SECONDS);
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
        if (player == null || networkHandler == null) {
            throw new ActionException("NOT_IN_WORLD");
        }
        return player;
    }

    private String getString(Map<String, Object> params, String key) {
        if (params == null || params.get(key) == null) {
            throw new ActionException("INVALID_PARAMS");
        }
        return String.valueOf(params.get(key));
    }

    private String stripLeadingSlash(String command) {
        return command.startsWith("/") ? command.substring(1) : command;
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
