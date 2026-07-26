package com.mct.legacy;

import com.google.gson.JsonObject;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import net.minecraft.client.entity.EntityPlayerSP;

public final class ChatActions extends LegacyActions {

    private static final double DEFAULT_WAIT_TIMEOUT_SECONDS = 10.0D;

    private final ChatRecorder recorder;

    public ChatActions(ChatRecorder recorder) {
        this.recorder = recorder;
    }

    @Override
    public Map<String, Object> handle(String action, JsonObject params) {
        if ("chat.send".equals(action)) {
            return onClient(() -> {
                EntityPlayerSP player = requirePlayer();
                player.sendChatMessage(Params.requireString(params, "message"));
                return map("sent", true);
            });
        }
        if ("chat.command".equals(action)) {
            return onClient(() -> {
                EntityPlayerSP player = requirePlayer();
                String command = Params.requireString(params, "command");
                player.sendChatMessage(command.startsWith("/") ? command : "/" + command);
                return map("sent", true);
            });
        }
        if ("chat.clear".equals(action)) {
            return map("cleared", true, "removed", recorder.clear());
        }
        if ("chat.history".equals(action)) {
            String match = Params.has(params, "match") ? Params.string(params, "match") : null;
            int last = Params.intValue(params, "last", 10);
            return waitForCondition(
                params,
                () -> map("messages", recorder.history(last)),
                result -> {
                    if (match == null) {
                        return true;
                    }
                    for (Object message : (Iterable<?>) result.get("messages")) {
                        if (messageContains(message, match)) {
                            return true;
                        }
                    }
                    return false;
                }
            );
        }
        if ("chat.last".equals(action)) {
            String match = Params.has(params, "match") ? Params.string(params, "match") : null;
            return waitForCondition(
                params,
                () -> map("message", recorder.last()),
                result -> match == null || messageContains(result.get("message"), match)
            );
        }
        if ("chat.wait".equals(action)) {
            Pattern pattern = compileFlexiblePattern(Params.requireString(params, "match"));
            long startedAt = System.currentTimeMillis();
            double timeoutSeconds = Params.doubleValue(params, "timeout", DEFAULT_WAIT_TIMEOUT_SECONDS);
            Map<String, Object> matched = pollOnClient(
                timeoutSeconds,
                () -> recorder.findLatest(pattern, startedAt),
                result -> !result.isEmpty(),
                "TIMEOUT"
            );
            return map("matched", true, "message", matched);
        }
        throw new LegacyActionException("INVALID_ACTION");
    }

    private Pattern compileFlexiblePattern(String value) {
        try {
            return Pattern.compile(value);
        } catch (PatternSyntaxException ignored) {
            return Pattern.compile(Pattern.quote(value));
        }
    }

    private boolean messageContains(Object message, String match) {
        if (!(message instanceof Map)) {
            return false;
        }
        Map<?, ?> messageMap = (Map<?, ?>) message;
        for (String key : new String[] {"plain", "content", "raw"}) {
            Object value = messageMap.get(key);
            if (value != null && String.valueOf(value).contains(match)) {
                return true;
            }
        }
        return false;
    }
}
