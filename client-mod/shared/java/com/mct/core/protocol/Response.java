package com.mct.core.protocol;

import java.util.Map;

public final class Response {

    private final String id;
    private final boolean success;
    private final Map<String, Object> data;
    private final String error;
    private final int eventsSinceLastCall;
    private final String lastEventType;

    public Response(
        String id,
        boolean success,
        Map<String, Object> data,
        String error,
        int eventsSinceLastCall,
        String lastEventType
    ) {
        this.id = id;
        this.success = success;
        this.data = data;
        this.error = error;
        this.eventsSinceLastCall = eventsSinceLastCall;
        this.lastEventType = lastEventType;
    }

    public String id() {
        return id;
    }

    public boolean success() {
        return success;
    }

    public Map<String, Object> data() {
        return data;
    }

    public String error() {
        return error;
    }

    public int eventsSinceLastCall() {
        return eventsSinceLastCall;
    }

    public String lastEventType() {
        return lastEventType;
    }
}
