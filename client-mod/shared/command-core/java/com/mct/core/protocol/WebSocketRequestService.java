package com.mct.core.protocol;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.reflect.TypeToken;
import com.mct.core.concurrent.ConnectionRequestDispatcher;
import java.lang.reflect.Type;
import java.math.BigDecimal;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;

/** Shared validation, admission and response framing; adapters only execute game actions and write frames. */
public final class WebSocketRequestService<K> implements AutoCloseable {
    public static final long MAX_TIMEOUT_MILLIS = 86_400_000L;
    private static final Gson GSON = new GsonBuilder().serializeNulls().create();
    private static final Type PARAMS_TYPE = new TypeToken<Map<String, Object>>() {}.getType();

    @FunctionalInterface
    public interface Actions {
        Map<String, Object> execute(String action, Map<String, Object> params) throws Exception;
    }

    public static final class Events {
        public final int count;
        public final String lastType;
        public Events(int count, String lastType) { this.count = count; this.lastType = lastType; }
    }

    private final ConnectionRequestDispatcher<K> dispatcher = new ConnectionRequestDispatcher<>();
    private final long defaultQueueTimeoutMillis;
    private final Actions actions;
    private final Function<Throwable, String> errorCode;
    private final Supplier<Events> events;

    public WebSocketRequestService(long defaultQueueTimeoutMillis, Actions actions,
                                   Function<Throwable, String> errorCode, Supplier<Events> events) {
        this.defaultQueueTimeoutMillis = defaultQueueTimeoutMillis;
        this.actions = actions;
        this.errorCode = errorCode;
        this.events = events;
    }

    public boolean open(K connection) { return dispatcher.open(connection); }
    public void closeConnection(K connection) { dispatcher.closeConnection(connection); }
    @Override public void close() {
        try { dispatcher.close(); }
        finally { com.mct.core.concurrent.TemporaryInputLeases.getInstance().closeAll(); }
    }

    /** Authentication/handshake must have succeeded before calling this method. */
    public void receive(K connection, String raw, Consumer<String> send) {
        long receivedAt = System.nanoTime();
        String id = UUID.randomUUID().toString();
        String action;
        Map<String, Object> params;
        long budget = defaultQueueTimeoutMillis;
        boolean totalBudget = false;
        try {
            JsonElement parsed = new JsonParser().parse(raw);
            if (!parsed.isJsonObject()) throw new IllegalArgumentException("Expected request object");
            JsonObject request = parsed.getAsJsonObject();
            if (request.has("id") && !request.get("id").isJsonNull()) {
                id = string(request.get("id"));
                if (id.isEmpty() || id.length() > 256) throw new IllegalArgumentException("Invalid request ID");
            }
            action = string(request.get("action"));
            if (action.isEmpty() || action.length() > 128) throw new IllegalArgumentException("Invalid action");
            JsonElement rawParams = request.get("params");
            if (rawParams == null || rawParams.isJsonNull()) params = Collections.emptyMap();
            else {
                if (!rawParams.isJsonObject()) throw new IllegalArgumentException("Expected params object");
                params = GSON.fromJson(rawParams, PARAMS_TYPE);
            }
            if (request.has("timeoutMs")) {
                JsonElement timeout = request.get("timeoutMs");
                if (!timeout.isJsonPrimitive() || !timeout.getAsJsonPrimitive().isNumber()) {
                    throw new IllegalArgumentException("Invalid timeoutMs");
                }
                // Validate the exact JSON decimal. A double would round e.g.
                // 1.0000000000000001 into an integer and admit an invalid budget.
                String token = timeout.getAsString();
                if (token.length() > 64) throw new IllegalArgumentException("Invalid timeoutMs length");
                BigDecimal decimal = new BigDecimal(token);
                // Bound scale before exact conversion: extreme exponents must not
                // cause BigDecimal to allocate enormous powers of ten.
                if (decimal.scale() < -8 || decimal.scale() > 64) {
                    throw new IllegalArgumentException("Invalid timeoutMs exponent");
                }
                budget = decimal.longValueExact();
                if (budget < 1 || budget > MAX_TIMEOUT_MILLIS) {
                    throw new IllegalArgumentException("timeoutMs must be an integer from 1 to 86400000");
                }
                totalBudget = true;
            }
        } catch (RuntimeException invalid) {
            send.accept(response(id, false, null, "INVALID_PARAMS", details("validation", false)));
            return;
        }

        final String requestId = id;
        final String requestAction = action;
        final Map<String, Object> requestParams = params;
        dispatcher.submit(connection, budget, receivedAt, totalBudget,
            () -> actions.execute(requestAction, requestParams),
            data -> send.accept(response(requestId, true, data, null, null)),
            failure -> {
                String code;
                switch (failure.getCode()) {
                    case BUSY: code = "CLIENT_BUSY"; break;
                    case TIMEOUT: code = "TIMEOUT"; break;
                    default:
                        code = failure.getCause() == null ? "INTERNAL_ERROR" : errorCode.apply(failure.getCause());
                        if (code == null) code = "INTERNAL_ERROR";
                }
                String phase = failure.getCode() == ConnectionRequestDispatcher.FailureCode.BUSY
                    ? "admission" : failure.isStarted() ? "execution" : "queue";
                send.accept(response(requestId, false, null, code, details(phase, failure.isResultUnknown())));
            });
    }

    private static String string(JsonElement value) {
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
            throw new IllegalArgumentException("Expected string");
        }
        return value.getAsString();
    }

    private static Map<String, Object> details(String phase, boolean resultUnknown) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("phase", phase);
        details.put("resultUnknown", resultUnknown);
        return details;
    }

    private String response(String id, boolean success, Map<String, Object> data, String error,
                            Map<String, Object> details) {
        Events pointer = events.get();
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("id", id);
        response.put("success", success);
        response.put("data", data);
        response.put("error", error);
        response.put("eventsSinceLastCall", pointer.count);
        response.put("lastEventType", pointer.lastType);
        if (details != null) response.put("details", details);
        return GSON.toJson(response);
    }
}
