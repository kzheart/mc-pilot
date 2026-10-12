package com.mct.core.resourcepack;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.mixin.ConfirmScreenAccessor;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConfirmScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.client.multiplayer.ServerList;
import net.minecraft.network.Connection;

/** Connection policy and the exact confirmation screen supplied by vanilla's pack handler. */
public final class ResourcePackSupport {
    private static final Map<String, String> overrides = new HashMap<>();
    private static final Map<String, ServerData> rememberedServers = new HashMap<>();
    private static Screen promptScreen;
    private static String effectivePolicy = "accept";
    private static volatile Connection activeConnection;

    private ResourcePackSupport() {}

    public static void setOverride(String address, String value) {
        try {
            String policy = ResourcePackPolicy.parse(value);
            if (policy != null) overrides.put(key(address), policy);
        } catch (IllegalArgumentException exception) {
            throw new ActionException("INVALID_PARAMS");
        }
    }

    public static ServerData connectionInfo(Minecraft client, ServerData fallback) {
        ServerData current = client.getCurrentServer();
        if (current != null && key(current.ip).equals(key(fallback.ip))) return current;
        ServerList list = new ServerList(client);
        list.load();
        for (int i = 0; i < list.size(); i++) {
            ServerData saved = list.get(i);
            if (key(saved.ip).equals(key(fallback.ip))) return saved;
        }
        if (list instanceof HiddenServerEntries hidden) {
            for (ServerData saved : hidden.mct$getHiddenServers()) {
                if (key(saved.ip).equals(key(fallback.ip))) return saved;
            }
        }
        return rememberedServers.getOrDefault(key(fallback.ip), fallback);
    }

    public static ServerData prepareConnection(ServerData info) {
        if (info == null) return null;
        // ConnectScreen's entry point is also used by initial quick-play connections.
        ServerData existing = connectionInfo(Minecraft.getInstance(), info);
        String policy;
        try {
            policy = ResourcePackPolicy.resolve(overrides.get(key(info.ip)),
                System.getenv("MCT_CLIENT_RESOURCE_PACK_POLICY"),
                existing.getResourcePackStatus() == ServerData.ServerPackStatus.DISABLED);
        } catch (IllegalArgumentException exception) {
            // Invalid externally supplied policy must not silently grant acceptance.
            policy = "prompt";
        }
        effectivePolicy = policy;
        existing.setResourcePackStatus(switch (policy) {
            case "reject" -> ServerData.ServerPackStatus.DISABLED;
            case "prompt" -> ServerData.ServerPackStatus.PROMPT;
            default -> ServerData.ServerPackStatus.ENABLED;
        });
        rememberedServers.put(key(existing.ip), existing);
        promptScreen = null;
        activeConnection = null;
        ClientStateTracker.getInstance().resourcePacks().reset(policy);
        return existing;
    }

    public static void bindConnection(Connection connection) {
        activeConnection = connection;
    }

    public static boolean isActiveConnection(Connection connection) {
        return connection == activeConnection;
    }

    public static void capturePrompt(Screen screen) {
        if (screen instanceof ConfirmScreen) {
            promptScreen = screen;
            ClientStateTracker.getInstance().resourcePacks().prompt(true);
        }
    }

    public static boolean isPrompt(Minecraft client) {
        boolean pending = promptScreen != null && com.mct.version.ClientVersionModulesHolder.get().compatibility().getScreen(client) == promptScreen;
        ClientStateTracker.getInstance().resourcePacks().prompt(pending);
        return pending;
    }

    public static void applyPromptPolicy(Minecraft client) {
        // Vanilla displays required-pack confirmations even for a saved refusal.
        if ("reject".equals(effectivePolicy)) answerPrompt(client, false);
    }

    public static boolean answerPrompt(Minecraft client, boolean accept) {
        if (!isPrompt(client)) return false;
        Screen screen = promptScreen;
        promptScreen = null;
        ClientStateTracker.getInstance().resourcePacks().prompt(false);
        ((ConfirmScreenAccessor) screen).mct$getCallback().accept(accept);
        return true;
    }

    private static String key(String address) {
        ServerAddress parsed = ServerAddress.parseString(address.trim());
        return parsed.getHost().toLowerCase(Locale.ROOT) + ":" + parsed.getPort();
    }
}
