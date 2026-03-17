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
                return Map.of("sent", true);
            });
            case "chat.command" -> runOnClientThread(() -> {
                ClientPlayerEntity player = requirePlayer();
                String command = stripLeadingSlash(getString(params, "command"));
                ClientVersionModulesHolder.get().interaction().sendCommand(player, command);
                return Map.of("sent", true);
            });
            case "chat.history" -> runOnClientThread(() -> Map.of("messages", stateTracker.getChatHistory(getInt(params, "last", 10))));
            case "chat.last" -> runOnClientThread(() -> Map.of("message", stateTracker.getLastChatMessage()));
            case "chat.wait" -> waitForChat(params);
            default -> throw new ActionException("INVALID_ACTION");
        };
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
        return Map.of("matched", true, "message", matched);
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
}
