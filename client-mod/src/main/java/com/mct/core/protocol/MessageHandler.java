package com.mct.core.protocol;

import java.util.Map;

public final class MessageHandler {

    public Response handle(Request request) {
        return new Response(
            request.id(),
            true,
            Map.of("action", request.action(), "status", "placeholder"),
            null
        );
    }
}
