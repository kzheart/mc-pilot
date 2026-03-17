package com.mct.core.util;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.jetbrains.annotations.Nullable;

public final class ParamHelper {

    private ParamHelper() {
    }

    public static Object getRequired(Map<String, Object> params, String key) {
        if (params == null || !params.containsKey(key) || params.get(key) == null) {
            throw new ActionException("INVALID_PARAMS");
        }
        return params.get(key);
    }

    public static String getString(Map<String, Object> params, String key) {
        return String.valueOf(getRequired(params, key));
    }

    public static String getString(Map<String, Object> params, String key, String defaultValue) {
        return params != null && params.containsKey(key) && params.get(key) != null ? String.valueOf(params.get(key)) : defaultValue;
    }

    @Nullable
    public static String getOptionalString(Map<String, Object> params, String key) {
        return params != null && params.containsKey(key) && params.get(key) != null ? String.valueOf(params.get(key)) : null;
    }

    public static int getInt(Map<String, Object> params, String key) {
        return asInt(getRequired(params, key));
    }

    public static int getInt(Map<String, Object> params, String key, int defaultValue) {
        return params != null && params.containsKey(key) && params.get(key) != null ? asInt(params.get(key)) : defaultValue;
    }

    public static double getDouble(Map<String, Object> params, String key) {
        return asDouble(getRequired(params, key));
    }

    public static double getDouble(Map<String, Object> params, String key, double defaultValue) {
        return params != null && params.containsKey(key) && params.get(key) != null ? asDouble(params.get(key)) : defaultValue;
    }

    public static boolean getBoolean(Map<String, Object> params, String key, boolean defaultValue) {
        if (params == null || !params.containsKey(key) || params.get(key) == null) {
            return defaultValue;
        }
        Object value = params.get(key);
        if (value instanceof Boolean booleanValue) {
            return booleanValue;
        }
        if (value instanceof Number number) {
            return number.intValue() != 0;
        }
        return Boolean.parseBoolean(String.valueOf(value));
    }

    @SuppressWarnings("unchecked")
    public static List<Object> getList(Map<String, Object> params, String key) {
        Object value = getRequired(params, key);
        if (value instanceof List<?> list) {
            return (List<Object>) list;
        }
        throw new ActionException("INVALID_PARAMS");
    }

    public static List<String> getStringList(Map<String, Object> params, String key) {
        if (params == null || !params.containsKey(key) || params.get(key) == null) {
            return List.of();
        }
        return getList(params, key).stream()
            .map(String::valueOf)
            .map(value -> value.toLowerCase(Locale.ROOT).trim())
            .filter(value -> !value.isEmpty())
            .toList();
    }

    public static int asInt(Object value) {
        if (value instanceof Number number) {
            return number.intValue();
        }
        return Integer.parseInt(String.valueOf(value));
    }

    public static double asDouble(Object value) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        return Double.parseDouble(String.valueOf(value));
    }
}
