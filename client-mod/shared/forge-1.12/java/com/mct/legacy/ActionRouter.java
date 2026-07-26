package com.mct.legacy;

import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Prefix-based dispatch mirroring the modern ActionDispatcher; runs on connection threads. */
public final class ActionRouter {

    /** Handles one action; may block (waits, polling loops) — never called on the main thread. */
    public interface Handler {
        Map<String, Object> handle(String action, JsonObject params);
    }

    private static final class Route {
        final String[] prefixes;
        final Handler handler;

        Route(String[] prefixes, Handler handler) {
            this.prefixes = prefixes;
            this.handler = handler;
        }
    }

    private final List<Route> routes = new ArrayList<Route>();

    public void register(Handler handler, String... prefixes) {
        routes.add(new Route(prefixes, handler));
    }

    public Map<String, Object> execute(String action, JsonObject params) {
        for (Route route : routes) {
            for (String prefix : route.prefixes) {
                boolean matches = prefix.endsWith(".") ? action.startsWith(prefix) : action.equals(prefix);
                if (matches) {
                    return route.handler.handle(action, params);
                }
            }
        }
        throw new LegacyActionException("INVALID_ACTION");
    }
}
