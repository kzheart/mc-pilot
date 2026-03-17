package com.mct.core.protocol;

import java.util.Map;

public final class Response {

    private final String id;
    private final boolean success;
    private final Map<String, Object> data;
    private final String error;

    public Response(String id, boolean success, Map<String, Object> data, String error) {
        this.id = id;
        this.success = success;
        this.data = data;
        this.error = error;
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
}
