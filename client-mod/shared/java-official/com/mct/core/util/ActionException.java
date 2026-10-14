package com.mct.core.util;

public final class ActionException extends RuntimeException {

    private final String code;

    public ActionException(String code) {
        this.code = code;
    }

    public ActionException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
