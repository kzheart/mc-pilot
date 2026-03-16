package com.mct.core.protocol;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

public final class JsonUtil {

    private static final Gson GSON = new GsonBuilder().serializeNulls().create();

    private JsonUtil() {
    }

    public static <T> T fromJson(String raw, Class<T> type) {
        return GSON.fromJson(raw, type);
    }

    public static String toJson(Object value) {
        return GSON.toJson(value);
    }
}
