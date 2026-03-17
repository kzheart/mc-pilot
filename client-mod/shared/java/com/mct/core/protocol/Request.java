package com.mct.core.protocol;

import java.util.Map;

public final class Request {

    private final String id;
    private final String action;
    private final Map<String, Object> params;

    public Request(String id, String action, Map<String, Object> params) {
        this.id = id;
        this.action = action;
        this.params = params;
    }

    public String id() {
        return id;
    }

    public String action() {
        return action;
    }

    public Map<String, Object> params() {
        return params;
    }
}
