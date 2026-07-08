package com.mct.core.util;

import com.mct.core.state.ClientStateTracker;
import com.mct.version.ClientVersionModulesHolder;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.resolver.ServerAddress;

public final class SessionReliability {

    private static int reconnectAttempts;
    private static long lastReconnectAttemptAt;

    private SessionReliability() {}

    public static void markInWorld() {
        reconnectAttempts = 0;
    }

    public static boolean tryAutoReconnect(Minecraft client, ClientStateTracker stateTracker) {
        if (client.player != null && client.player.connection != null && ClientVersionModulesHolder.get().clientWorld().getClientWorld(client.player) != null) {
            markInWorld();
            return false;
        }

        String address = System.getenv("MCT_CLIENT_SERVER");
        if (address == null || address.trim().isEmpty() || !ServerAddress.isValidAddress(address)) {
            return false;
        }

        int maxAttempts = parseMaxAttempts();
        if (maxAttempts <= 0 || reconnectAttempts >= maxAttempts || !isReconnectableScreen(client.gui.screen())) {
            return false;
        }

        long now = System.currentTimeMillis();
        if (now - lastReconnectAttemptAt < 5_000L) {
            return false;
        }

        reconnectAttempts++;
        lastReconnectAttemptAt = now;
        Screen parent = client.gui.screen() != null ? client.gui.screen() : new TitleScreen();
        ClientVersionModulesHolder.get().reconnect().connect(client, parent, ServerAddress.parseString(address), address);
        return true;
    }

    public static String disconnectReason(Minecraft client) {
        MapLikeScreen screen = MapLikeScreen.from(client.gui.screen());
        if (screen == null || !screen.isDisconnectLike()) {
            return "";
        }
        return screen.title;
    }

    public static String screenCategory(Minecraft client) {
        MapLikeScreen screen = MapLikeScreen.from(client.gui.screen());
        if (screen == null) {
            return "game";
        }
        if (screen.isDisconnectLike()) {
            return "disconnected";
        }
        if (screen.isTitleLike()) {
            return "title";
        }
        if (screen.className.contains("MultiplayerScreen") || screen.title.toLowerCase(java.util.Locale.ROOT).contains("multiplayer")) {
            return "multiplayer";
        }
        return "screen";
    }

    private static int parseMaxAttempts() {
        String value = System.getenv("MCT_CLIENT_AUTO_RECONNECTS");
        if (value == null || value.trim().isEmpty()) {
            return 2;
        }
        try {
            return Math.max(0, Integer.parseInt(value.trim()));
        } catch (NumberFormatException ignored) {
            return 2;
        }
    }

    private static boolean isReconnectableScreen(Screen screen) {
        MapLikeScreen mapped = MapLikeScreen.from(screen);
        return mapped != null && (mapped.isDisconnectLike() || mapped.isTitleLike() || mapped.className.contains("MultiplayerScreen"));
    }

    private static final class MapLikeScreen {
        final String className;
        final String title;

        private MapLikeScreen(String className, String title) {
            this.className = className;
            this.title = title;
        }

        static MapLikeScreen from(Screen screen) {
            if (screen == null) {
                return null;
            }
            String className = screen.getClass().getName();
            String title = screen.getTitle() != null ? screen.getTitle().getString() : "";
            return new MapLikeScreen(className, title);
        }

        boolean isDisconnectLike() {
            String lowerTitle = title.toLowerCase(java.util.Locale.ROOT);
            return className.contains("DisconnectedScreen")
                || className.contains("DisconnectScreen")
                || lowerTitle.contains("disconnect")
                || lowerTitle.contains("failed to connect")
                || lowerTitle.contains("连接失败")
                || lowerTitle.contains("断开");
        }

        boolean isTitleLike() {
            return className.contains("TitleScreen");
        }
    }
}
