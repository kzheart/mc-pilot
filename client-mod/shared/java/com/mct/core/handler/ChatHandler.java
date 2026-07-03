package com.mct.core.handler;

import static com.mct.core.util.ParamHelper.*;

import com.mct.core.state.ClientStateTracker;
import com.mct.core.util.ActionException;
import com.mct.version.ClientVersionModulesHolder;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.network.ClientPlayerEntity;

public final class ChatHandler extends ActionHandler {

    private static final double DEFAULT_WAIT_TIMEOUT_SECONDS = 10.0D;

    public ChatHandler(MinecraftClient client, ClientStateTracker stateTracker) {
        super(client, stateTracker);
    }

    @Override
    public Map<String, Object> handle(String action, Map<String, Object> params) {
        return switch (action) {
            case "chat.send" -> runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                ClientVersionModulesHolder.get().interaction().sendChatMessage(player, getString(params, "message"));
                return com.mct.core.util.MctMaps.mapOf("sent", true);
            });
            case "chat.command" -> runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                String command = stripLeadingSlash(getString(params, "command"));
                ClientVersionModulesHolder.get().interaction().sendCommand(player, command);
                return com.mct.core.util.MctMaps.mapOf("sent", true);
            });
            case "chat.clear" -> runOnClientThread(() -> com.mct.core.util.MctMaps.mapOf(
                "cleared", true,
                "removed", stateTracker.clearChatHistory()
            ));
            case "chat.history" -> chatHistory(params);
            case "chat.last" -> chatLast(params);
            case "chat.wait" -> waitForChat(params);
            default -> throw new ActionException("INVALID_ACTION");
        };
    }

    private Map<String, Object> chatHistory(Map<String, Object> params) {
        String match = getOptionalString(params, "match");
        return waitForCondition(
            params,
            () -> com.mct.core.util.MctMaps.mapOf("messages", stateTracker.getChatHistory(getInt(params, "last", 10))),
            result -> match == null || messagesContain(result, match)
        );
    }

    private Map<String, Object> chatLast(Map<String, Object> params) {
        String match = getOptionalString(params, "match");
        return waitForCondition(
            params,
            () -> com.mct.core.util.MctMaps.mapOf("message", stateTracker.getLastChatMessage()),
            result -> match == null || messageContains(result.get("message"), match)
        );
    }

    private Map<String, Object> waitForChat(Map<String, Object> params) {
        Pattern pattern = compileFlexiblePattern(getString(params, "match"));
        long startedAt = System.currentTimeMillis();
        double timeoutSeconds = getDouble(params, "timeout", DEFAULT_WAIT_TIMEOUT_SECONDS);
        Map<String, Object> matched = pollOnClientThread(
            timeoutSeconds,
            () -> stateTracker.findLatestChatMessage(pattern, startedAt),
            result -> !result.isEmpty(),
            "TIMEOUT"
        );
        return com.mct.core.util.MctMaps.mapOf("matched", true, "message", matched);
    }

    private Pattern compileFlexiblePattern(String value) {
        try {
            return Pattern.compile(value);
        } catch (PatternSyntaxException ignored) {
            return Pattern.compile(Pattern.quote(value));
        }
    }

    private String stripLeadingSlash(String command) {
        return command.startsWith("/") ? command.substring(1) : command;
    }

    @SuppressWarnings("unchecked")
    private boolean messagesContain(Map<String, Object> result, String match) {
        Object messages = result.get("messages");
        if (!(messages instanceof Iterable<?> iterable)) {
            return false;
        }
        for (Object message : iterable) {
            if (messageContains(message, match)) {
                return true;
            }
        }
        return false;
    }

    private boolean messageContains(Object message, String match) {
        if (!(message instanceof Map<?, ?> map)) {
            return false;
        }
        for (String key : new String[] { "plain", "content", "raw" }) {
            Object value = map.get(key);
            if (value != null && String.valueOf(value).contains(match)) {
                return true;
            }
        }
        return false;
    }
}
