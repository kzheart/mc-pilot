package com.mct.legacy;

public final class LegacyActionException extends RuntimeException {

    public final String code;

    public LegacyActionException(String code) {
        super(code);
        this.code = code;
    }

    public LegacyActionException(String code, String detail) {
        super(code + ": " + detail);
        this.code = code;
    }
}
