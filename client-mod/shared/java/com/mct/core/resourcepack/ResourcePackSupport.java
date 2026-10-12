package com.mct.core.resourcepack;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.mixin.ConfirmScreenAccessor;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.ConfirmScreen;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.network.ServerInfo;
import net.minecraft.client.network.ServerAddress;
import net.minecraft.client.option.ServerList;
import net.minecraft.network.ClientConnection;

/** Connection policy and the exact confirmation screen supplied by vanilla's pack handler. */
public final class ResourcePackSupport {
    private static final Map<String, String> overrides = new HashMap<>();
    private static final Map<String, ServerInfo> rememberedServers = new HashMap<>();
    private static Screen promptScreen;
    private static String effectivePolicy = "accept";
    private static volatile ClientConnection activeConnection;

    private ResourcePackSupport() {}

    public static void setOverride(String address, String value) {
        try {
            String policy = ResourcePackPolicy.parse(value);
            if (policy != null) overrides.put(key(address), policy);
        } catch (IllegalArgumentException exception) {
            throw new ActionException("INVALID_PARAMS");
        }
    }

    public static ServerInfo connectionInfo(MinecraftClient client, ServerInfo fallback) {
        ServerInfo current = client.getCurrentServerEntry();
        if (current != null && key(current.address).equals(key(fallback.address))) return current;
        ServerList list = new ServerList(client);
        list.loadFile();
        for (int i = 0; i < list.size(); i++) {
            ServerInfo saved = list.get(i);
            if (key(saved.address).equals(key(fallback.address))) return saved;
        }
        if (list instanceof HiddenServerEntries hidden) {
            for (ServerInfo saved : hidden.mct$getHiddenServers()) {
                if (key(saved.address).equals(key(fallback.address))) return saved;
            }
        }
        return rememberedServers.getOrDefault(key(fallback.address), fallback);
    }

    public static ServerInfo prepareConnection(ServerInfo info) {
        if (info == null) return null;
        // ConnectScreen's entry point is also used by initial quick-play connections.
        ServerInfo existing = connectionInfo(MinecraftClient.getInstance(), info);
        String policy;
        try {
            policy = ResourcePackPolicy.resolve(overrides.get(key(info.address)),
                System.getenv("MCT_CLIENT_RESOURCE_PACK_POLICY"),
                existing.getResourcePackPolicy() == ServerInfo.ResourcePackPolicy.DISABLED);
        } catch (IllegalArgumentException exception) {
            // Invalid externally supplied policy must not silently grant acceptance.
            policy = "prompt";
        }
        effectivePolicy = policy;
        existing.setResourcePackPolicy(switch (policy) {
            case "reject" -> ServerInfo.ResourcePackPolicy.DISABLED;
            case "prompt" -> ServerInfo.ResourcePackPolicy.PROMPT;
            default -> ServerInfo.ResourcePackPolicy.ENABLED;
        });
        rememberedServers.put(key(existing.address), existing);
        promptScreen = null;
        activeConnection = null;
        ClientStateTracker.getInstance().resourcePacks().reset(policy);
        return existing;
    }

    public static void bindConnection(ClientConnection connection) {
        activeConnection = connection;
    }

    public static boolean isActiveConnection(ClientConnection connection) {
        return connection == activeConnection;
    }

    public static void capturePrompt(Screen screen) {
        if (screen instanceof ConfirmScreen) {
            promptScreen = screen;
            ClientStateTracker.getInstance().resourcePacks().prompt(true);
        }
    }

    public static boolean isPrompt(MinecraftClient client) {
        boolean pending = promptScreen != null && client.currentScreen == promptScreen;
        ClientStateTracker.getInstance().resourcePacks().prompt(pending);
        return pending;
    }

    public static void applyPromptPolicy(MinecraftClient client) {
        // Vanilla displays required-pack confirmations even for a saved refusal.
        if ("reject".equals(effectivePolicy)) answerPrompt(client, false);
    }

    public static boolean answerPrompt(MinecraftClient client, boolean accept) {
        if (!isPrompt(client)) return false;
        Screen screen = promptScreen;
        promptScreen = null;
        ClientStateTracker.getInstance().resourcePacks().prompt(false);
        ((ConfirmScreenAccessor) screen).mct$getCallback().accept(accept);
        return true;
    }

    private static String key(String address) {
        ServerAddress parsed = ServerAddress.parse(address.trim());
        return parsed.getAddress().toLowerCase(Locale.ROOT) + ":" + parsed.getPort();
    }
}
