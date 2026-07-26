package com.mct.legacy;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;

public final class Params {

    private Params() {
    }

    public static String string(JsonObject object, String name) {
        JsonElement value = object.get(name);
        return value == null || value.isJsonNull() ? "" : value.getAsString();
    }

    public static String string(JsonObject object, String name, String fallback) {
        JsonElement value = object.get(name);
        return value == null || value.isJsonNull() ? fallback : value.getAsString();
    }

    public static String requireString(JsonObject object, String name) {
        String value = string(object, name);
        if (value.isEmpty()) {
            throw new LegacyActionException("INVALID_PARAMS", "missing " + name);
        }
        return value;
    }

    public static int intValue(JsonObject object, String name, int fallback) {
        JsonElement value = object.get(name);
        return value == null || value.isJsonNull() ? fallback : value.getAsInt();
    }

    public static double doubleValue(JsonObject object, String name, double fallback) {
        JsonElement value = object.get(name);
        return value == null || value.isJsonNull() ? fallback : value.getAsDouble();
    }

    public static double requireDouble(JsonObject object, String name) {
        JsonElement value = object.get(name);
        if (value == null || value.isJsonNull()) {
            throw new LegacyActionException("INVALID_PARAMS", "missing " + name);
        }
        return value.getAsDouble();
    }

    public static int requireInt(JsonObject object, String name) {
        JsonElement value = object.get(name);
        if (value == null || value.isJsonNull()) {
            throw new LegacyActionException("INVALID_PARAMS", "missing " + name);
        }
        return value.getAsInt();
    }

    public static boolean booleanValue(JsonObject object, String name, boolean fallback) {
        JsonElement value = object.get(name);
        return value == null || value.isJsonNull() ? fallback : value.getAsBoolean();
    }

    public static boolean has(JsonObject object, String name) {
        JsonElement value = object.get(name);
        return value != null && !value.isJsonNull();
    }

    public static List<String> stringList(JsonObject object, String name) {
        List<String> values = new ArrayList<String>();
        JsonElement value = object.get(name);
        if (value != null && value.isJsonArray()) {
            JsonArray array = value.getAsJsonArray();
            for (int index = 0; index < array.size(); index++) {
                JsonElement entry = array.get(index);
                values.add(entry.isJsonNull() ? null : entry.getAsString());
            }
        }
        return values;
    }

    public static JsonArray array(JsonObject object, String name) {
        JsonElement value = object.get(name);
        return value != null && value.isJsonArray() ? value.getAsJsonArray() : new JsonArray();
    }

    public static JsonObject object(JsonObject object, String name) {
        JsonElement value = object.get(name);
        return value != null && value.isJsonObject() ? value.getAsJsonObject() : new JsonObject();
    }
}
